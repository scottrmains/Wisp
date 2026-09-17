using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Wisp.Core.MixPlans;
using Wisp.Core.Recordings;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Recordings;

public sealed record RevisionSelection(Guid SourceEntryId, Guid? TrackId, bool Omit);
public sealed record PlanRevisionRequest(Guid RequestId, string Name, string Source, Guid? SnapshotId, int TracklistRevision,
    int FeedbackRevision, RevisionSelection[] Entries, Guid[] AnnotationIds, bool IncludeOverallNotes, bool ExcludeDrafts, string? PreviewToken = null);
public sealed record RevisionTrack(Guid SourceEntryId, Guid TrackId, string Artist, string Title, double? CueInSeconds, double? CueOutSeconds, bool IsAnchor, string? TransitionNotes);
public sealed record RevisionPreview(string Token, RevisionTrack[] Tracks, string Notes, string[] Problems, string[] Warnings, Guid? ParentPlanId, int ExcludedDrafts);

public static class RecordingPlanRevisions
{
    private sealed record SourceEntry(Guid Id, Guid? TrackId, string Title, BlueprintEntry? Blueprint, Guid? NextBlueprintId);
    private static string Hash(object value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value))));
    public static async Task<RevisionPreview> Preview(Guid id, PlanRevisionRequest request, RecordingSession session, WispDbContext db)
    {
        if (request.RequestId == Guid.Empty || string.IsNullOrWhiteSpace(request.Name) || request.Name.Length > 200 || request.Source is not ("actual" or "blueprint") ||
            request.Entries == null || request.Entries.Length > 500 || request.Entries.Any(e => e == null) || request.AnnotationIds == null || request.AnnotationIds.Length > 500 ||
            request.Entries.Select(e => e.SourceEntryId).Distinct().Count() != request.Entries.Length || request.AnnotationIds.Distinct().Count() != request.AnnotationIds.Length)
            throw new ArgumentException("Provide a name up to 200 characters, a source and distinct source entries/comments (maximum 500).");
        var list = await db.RecordingTracklists.AsNoTracking().SingleOrDefaultAsync(r => r.Id == id);
        var feedback = await db.RecordingFeedback.AsNoTracking().SingleOrDefaultAsync(r => r.Id == id);
        if ((list?.Revision ?? 0) != request.TracklistRevision || (feedback?.Revision ?? 0) != request.FeedbackRevision)
            throw new InvalidOperationException("The tracklist or saved feedback changed. Refresh and preview again before creating a plan.");
        var snapshots = await db.RecordingPlanSnapshots.AsNoTracking().Where(s => s.RecordingId == id).ToArrayAsync();
        var chosen = snapshots.FirstOrDefault(s => s.Id == (request.Source == "blueprint" ? request.SnapshotId : list?.ActiveSnapshotId));
        var blueprints = snapshots.ToDictionary(s => s.Id, s => JsonSerializer.Deserialize<Blueprint>(s.BlueprintJson)!);
        var allBlueprint = blueprints.Values.SelectMany(b => b.Entries.Select((e, index) => (Entry: e, Next: index + 1 < b.Entries.Length ? (Guid?)b.Entries[index + 1].Id : null))).ToDictionary(e => e.Entry.Id);
        var actual = FeedbackEndpoints.Read<PerformedEntry>(list?.EntriesJson);
        var drafts = request.Source == "actual" ? actual.Count(e => !e.Played) : 0;
        SourceEntry[] source;
        if (request.Source == "blueprint")
        {
            if (chosen == null) throw new ArgumentException("Choose one of this recording's saved blueprints.");
            source = blueprints[chosen.Id].Entries.Select(e => new SourceEntry(e.Id, e.TrackId, e.Title, e, allBlueprint[e.Id].Next)).ToArray();
        }
        else source = actual.Where(e => e.Played).Select(e =>
        {
            var blueprint = e.BlueprintEntryId.HasValue ? allBlueprint.GetValueOrDefault(e.BlueprintEntryId.Value) : default;
            return new SourceEntry(e.Id, e.TrackId, e.Title, blueprint.Entry, blueprint.Next);
        }).ToArray();
        if (!source.Select(e => e.Id).ToHashSet().SetEquals(request.Entries.Select(e => e.SourceEntryId)))
            throw new ArgumentException("Resolve every eligible source occurrence exactly once. Draft actual entries cannot be included; confirm them in the tracklist first.");
        var annotations = FeedbackEndpoints.Read<MixAnnotation>(feedback?.AnnotationsJson);
        if (request.AnnotationIds.Any(key => !annotations.Any(a => a.Id == key))) throw new ArgumentException("A selected comment no longer exists. Preview again.");
        var problems = new List<string>(); var warnings = new List<string>();
        if (drafts > 0 && !request.ExcludeDrafts) problems.Add($"Explicitly acknowledge excluding {drafts} unconfirmed draft entries, or confirm them in the actual tracklist first.");
        var ids = request.Entries.Where(e => e.TrackId.HasValue).Select(e => e.TrackId!.Value).ToArray();
        var tracks = await db.Tracks.AsNoTracking().Where(t => ids.Contains(t.Id)).ToDictionaryAsync(t => t.Id);
        var selections = request.Entries.ToDictionary(e => e.SourceEntryId);
        var kept = source.Where(e => !selections[e.Id].Omit).ToArray(); var output = new List<RevisionTrack>();
        for (var index = 0; index < kept.Length; index++)
        {
            var e = kept[index]; var selection = selections[e.Id];
            if (!selection.TrackId.HasValue || !tracks.TryGetValue(selection.TrackId.Value, out var track)) { problems.Add($"Match or explicitly omit “{e.Title}”; its library reference is missing."); continue; }
            if (track.IsUnavailable) warnings.Add($"“{e.Title}” is marked unavailable in the library. Relink its audio before practising; the new plan keeps its library identity.");
            var sameTrack = e.TrackId == track.Id; var blueprint = sameTrack ? e.Blueprint : null;
            double? Cue(double? seconds) => seconds.HasValue && double.IsFinite(seconds.Value) && seconds >= 0 && seconds <= track.Duration.TotalSeconds ? seconds : null;
            var cueIn = Cue(blueprint?.CueInSeconds); var cueOut = Cue(blueprint?.CueOutSeconds);
            if (cueIn.HasValue && cueOut.HasValue && cueOut <= cueIn) { cueIn = null; cueOut = null; }
            if (cueIn != blueprint?.CueInSeconds || cueOut != blueprint?.CueOutSeconds) warnings.Add($"Invalid source cue positions were cleared for “{e.Title}”.");
            var next = index + 1 < kept.Length ? kept[index + 1] : null;
            var preserveTransition = blueprint != null && e.NextBlueprintId == next?.Blueprint?.Id && (next == null || selections[next.Id].TrackId == next.TrackId);
            if (blueprint?.TransitionNotes != null && !preserveTransition) warnings.Add($"Transition notes for “{e.Title}” were not copied because its next track changed.");
            output.Add(new(e.Id, track.Id, track.Artist ?? "", track.Title ?? track.FileName, cueIn, cueOut, blueprint?.IsAnchor ?? false, preserveTransition ? blueprint?.TransitionNotes : null));
        }
        if (output.Count == 0) problems.Add("Keep at least one library track in the revised plan.");
        var selected = annotations.Where(a => request.AnnotationIds.Contains(a.Id)).ToArray();
        var notes = new StringBuilder($"Revised from recording: {session.Title}\nSource: {(request.Source == "actual" ? "confirmed actual tracklist" : "saved blueprint: " + chosen!.PlanName)}\n");
        if (request.Source == "blueprint" && !string.IsNullOrWhiteSpace(blueprints[chosen!.Id].Notes)) notes.AppendLine("Blueprint notes: " + blueprints[chosen.Id].Notes);
        if (request.IncludeOverallNotes && !string.IsNullOrWhiteSpace(feedback?.Notes)) notes.AppendLine("Overall review: " + feedback.Notes);
        if (selected.Length > 0) notes.AppendLine("Selected feedback — times refer to the recording, NOT track cue points:");
        foreach (var a in selected) notes.AppendLine($"[{a.Seconds:0.###}s{(a.EndSeconds.HasValue ? $"–{a.EndSeconds:0.###}s" : "")}] {a.Category ?? "Comment"} / {(a.Resolved ? "Resolved" : "Revisit")}{(a.AssociationLabel != null ? " / " + a.AssociationLabel : "")}: {a.Text}");
        var context = new { request.Name, request.Source, request.SnapshotId, request.TracklistRevision, request.FeedbackRevision, request.Entries, request.AnnotationIds, request.IncludeOverallNotes, request.ExcludeDrafts,
            Tracks = output, Notes = notes.ToString(), Problems = problems, Warnings = warnings, ParentPlanId = chosen?.SourcePlanId };
        return new(Hash(context), output.ToArray(), notes.ToString(), problems.ToArray(), warnings.ToArray(), chosen?.SourcePlanId, drafts);
    }
    public static async Task<object> Create(Guid id, PlanRevisionRequest request, RecordingSession session, WispDbContext db)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        var requestHash = Hash(request);
        var existing = await db.RecordingPlanRevisions.FindAsync(request.RequestId);
        if (existing != null)
        {
            if (existing.RecordingId != id || existing.RequestHash != requestHash) throw new InvalidOperationException("This creation request belongs to a different revision.");
            return new { PlanId = existing.Id, Exists = await db.MixPlans.AnyAsync(p => p.Id == existing.Id) };
        }
        var preview = await Preview(id, request, session, db);
        if (preview.Problems.Length > 0) throw new ArgumentException(string.Join(" ", preview.Problems));
        if (request.PreviewToken != preview.Token) throw new InvalidOperationException("The preview changed. Preview again and review the tracks before creating a plan.");
        var now = DateTime.UtcNow;
        var plan = new MixPlan { Id = request.RequestId, Name = request.Name.Trim(), Notes = preview.Notes, CreatedAt = now, UpdatedAt = now };
        plan.Tracks = preview.Tracks.Select((t, i) => new MixPlanTrack { Id = Guid.NewGuid(), MixPlanId = plan.Id, TrackId = t.TrackId, Order = i,
            CueInSeconds = t.CueInSeconds, CueOutSeconds = t.CueOutSeconds, IsAnchor = t.IsAnchor, TransitionNotes = t.TransitionNotes }).ToList();
        db.MixPlans.Add(plan);
        db.RecordingPlanRevisions.Add(new() { Id = plan.Id, RecordingId = id, RecordingTitle = session.Title, ParentPlanId = preview.ParentPlanId,
            SnapshotId = request.Source == "blueprint" ? request.SnapshotId : null, PlanName = plan.Name, Source = request.Source, CreatedAt = now,
            RequestHash = requestHash, ContextJson = JsonSerializer.Serialize(new { Request = request, Preview = preview }) });
        await db.SaveChangesAsync(); await tx.CommitAsync(); return new { PlanId = plan.Id, Exists = true };
    }
}
