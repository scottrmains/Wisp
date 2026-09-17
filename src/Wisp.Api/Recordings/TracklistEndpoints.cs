using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Wisp.Core.Recordings;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Recordings;

public static class TracklistEndpoints
{
    public sealed record LinkRequest(int Revision, Guid PlanId, Guid SnapshotId);
    public sealed record RevisionRequest(int Revision);
    public sealed record EntriesRequest(int Revision, PerformedEntry[] Entries, Guid? LiveEntryId = null);
    public static void MapRecordingTracklists(this WebApplication app)
    {
        var api = app.MapGroup("/api/recording-tracklists");
        api.MapGet("/library", async (string? q, WispDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(q)) return Results.Ok(Array.Empty<object>());
            var query = q.Trim().ToLowerInvariant();
            return Results.Ok(await db.Tracks.AsNoTracking().Where(t => (t.Title ?? t.FileName).ToLower().Contains(query) || (t.Artist ?? "").ToLower().Contains(query))
                .OrderBy(t => t.Artist).ThenBy(t => t.Title).Take(30).Select(t => new { t.Id, Artist = t.Artist ?? "", Title = t.Title ?? t.FileName }).ToArrayAsync());
        });
        api.MapGet("/plans/{planId:guid}/recordings", async (Guid planId, WispDbContext db) =>
        {
            var ids = db.RecordingPlanSnapshots.Where(s => s.SourcePlanId == planId).Select(s => s.RecordingId);
            return Results.Ok(await db.RecordingSessions.AsNoTracking().Where(s => ids.Contains(s.Id) && !s.Hidden && s.State != "Deleted")
                .OrderByDescending(s => s.StartedAt).Select(s => new { s.Id, s.Title, s.State, s.StartedAt }).ToArrayAsync());
        });
        api.MapGet("/{id:guid}", (Guid id, RecordingWorkspace workspace, WispDbContext db) => Guard(async () =>
        {
            await workspace.Require(id);
            var list = await db.RecordingTracklists.AsNoTracking().SingleOrDefaultAsync(t => t.Id == id);
            var snapshots = await db.RecordingPlanSnapshots.AsNoTracking().Where(s => s.RecordingId == id).OrderBy(s => s.TakenAt).ToArrayAsync();
            var plans = await db.MixPlans.Select(p => p.Id).ToArrayAsync();
            var entries = Read(list);
            var trackIds = entries.Where(e => e.TrackId.HasValue).Select(e => e.TrackId!.Value).ToArray();
            var available = await db.Tracks.Where(t => trackIds.Contains(t.Id)).Select(t => t.Id).ToArrayAsync();
            return Results.Ok(new { Revision = list?.Revision ?? 0, list?.ActiveSnapshotId, Entries = entries,
                MissingTrackIds = trackIds.Except(available), TimesDisagree = PerformedTracklist.TimesDisagree(entries),
                Snapshots = snapshots.Select(s => new { s.Id, s.SourcePlanId, s.PlanName, s.SourceUpdatedAt, s.TakenAt, s.Timing,
                    SourceExists = plans.Contains(s.SourcePlanId), Blueprint = JsonSerializer.Deserialize<Blueprint>(s.BlueprintJson) }) });
        }));
        api.MapPost("/{id:guid}/link", (Guid id, LinkRequest request, RecordingWorkspace workspace, WispDbContext db) => Guard(async () =>
        {
            await workspace.Require(id);
            if (request.SnapshotId == Guid.Empty) throw new ArgumentException("A snapshot request ID is required.");
            await using var tx = await db.Database.BeginTransactionAsync();
            var existing = await db.RecordingPlanSnapshots.FindAsync(request.SnapshotId);
            if (existing != null)
            {
                if (existing.RecordingId != id || existing.SourcePlanId != request.PlanId) throw new InvalidOperationException("This snapshot request belongs to another link.");
                return Results.NoContent();
            }
            var list = await Edit(db, id, request.Revision);
            var snapshot = await RecordingBlueprints.Capture(db, id, request.PlanId, request.SnapshotId, "Linked after recording started");
            db.RecordingPlanSnapshots.Add(snapshot); list.ActiveSnapshotId = snapshot.Id;
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.NoContent();
        }));
        api.MapPost("/{id:guid}/unlink", (Guid id, RevisionRequest request, RecordingWorkspace workspace, WispDbContext db) => Guard(async () =>
        {
            await workspace.Require(id); var list = await Edit(db, id, request.Revision); list.ActiveSnapshotId = null;
            await db.SaveChangesAsync(); return Results.NoContent(); // All historical snapshots stay intact.
        }));
        api.MapPost("/{id:guid}/copy", (Guid id, RevisionRequest request, RecordingWorkspace workspace, WispDbContext db) => Guard(async () =>
        {
            await workspace.Require(id); var list = await Edit(db, id, request.Revision);
            if (Read(list).Length != 0) throw new InvalidOperationException("Copying is a starting point for an empty actual tracklist. Existing entries were kept.");
            var snapshot = await db.RecordingPlanSnapshots.SingleOrDefaultAsync(s => s.Id == list.ActiveSnapshotId && s.RecordingId == id)
                ?? throw new InvalidOperationException("Link a blueprint before copying its planned tracks.");
            var entries = JsonSerializer.Deserialize<Blueprint>(snapshot.BlueprintJson)!.Entries.Select(e => new PerformedEntry(
                Guid.NewGuid(), e.TrackId, e.Artist[..Math.Min(300, e.Artist.Length)], e.Title[..Math.Min(300, e.Title.Length)], false, null, e.Id)).ToArray();
            list.EntriesJson = JsonSerializer.Serialize(entries); await db.SaveChangesAsync(); return Results.NoContent();
        }));
        api.MapPost("/{id:guid}/entries", (Guid id, EntriesRequest request, RecordingWorkspace workspace, MixRecorder recorder, WispDbContext db) => Guard(async () =>
        {
            var session = await workspace.Require(id); var list = await Edit(db, id, request.Revision); var old = Read(list);
            var status = recorder.Status;
            if (request.Entries == null || request.Entries.Any(e => e == null)) throw new ArgumentException("Tracklist entries are required.");
            if (request.LiveEntryId.HasValue)
            {
                if (!status.Busy || status.Session?.Id != id || status.Session.State != "Recording") throw new InvalidOperationException("This take is not currently recording. Set a start using playback instead.");
                if (request.Entries?.Count(e => e?.Id == request.LiveEntryId) != 1) throw new ArgumentException("Select one track occurrence to mark live.");
                request = request with { Entries = request.Entries!.Select(e => e.Id == request.LiveEntryId ? e with { Played = true, StartSeconds = status.Seconds } : e).ToArray() };
            }
            var duration = status.Busy && status.Session?.Id == id ? status.Seconds : session.AudioBytes / (session.SampleRate * 8d);
            PerformedTracklist.Validate(request.Entries, duration);
            var snapshots = await db.RecordingPlanSnapshots.Where(s => s.RecordingId == id).Select(s => s.BlueprintJson).ToArrayAsync();
            var blueprint = snapshots.SelectMany(s => JsonSerializer.Deserialize<Blueprint>(s)!.Entries).ToDictionary(e => e.Id);
            var requestedIds = request.Entries.Where(e => e.TrackId.HasValue).Select(e => e.TrackId!.Value).ToArray();
            var available = await db.Tracks.Where(t => requestedIds.Contains(t.Id)).Select(t => t.Id).ToArrayAsync();
            foreach (var entry in request.Entries)
            {
                var previous = old.FirstOrDefault(e => e.Id == entry.Id);
                if (previous != null && (previous.TrackId != entry.TrackId || previous.BlueprintEntryId != entry.BlueprintEntryId))
                    throw new ArgumentException("An occurrence's source identity cannot change. Remove it and add the replacement as a separate occurrence.");
                if (entry.BlueprintEntryId.HasValue && (!blueprint.TryGetValue(entry.BlueprintEntryId.Value, out var source) || source.TrackId != entry.TrackId))
                    throw new ArgumentException("This occurrence does not belong to one of this recording's saved blueprints.");
                if (previous == null && entry.TrackId.HasValue && !entry.BlueprintEntryId.HasValue && !available.Contains(entry.TrackId.Value))
                    throw new ArgumentException("That library track no longer exists. Add its artist/title manually instead.");
            }
            list.EntriesJson = JsonSerializer.Serialize(request.Entries); await db.SaveChangesAsync(); return Results.NoContent();
        }));
    }
    private static PerformedEntry[] Read(RecordingTracklist? list) => JsonSerializer.Deserialize<PerformedEntry[]>(list?.EntriesJson ?? "[]")!;
    private static async Task<RecordingTracklist> Edit(WispDbContext db, Guid id, int revision)
    {
        var list = await db.RecordingTracklists.FindAsync(id);
        if ((list?.Revision ?? 0) != revision) throw new InvalidOperationException("This tracklist changed. Refresh before retrying; no edits were applied.");
        if (list == null) { list = new() { Id = id }; db.RecordingTracklists.Add(list); }
        list.Revision++; return list;
    }
    private static async Task<IResult> Guard(Func<Task<IResult>> action)
    {
        try { return await action(); }
        catch (ArgumentException ex) { return Results.Json(new { message = ex.Message }, statusCode: 400); }
        catch (DbUpdateException) { return Results.Json(new { message = "The tracklist changed or could not be saved. Refresh and retry." }, statusCode: 409); }
        catch (InvalidOperationException ex) { return Results.Json(new { message = ex.Message }, statusCode: 409); }
        catch (JsonException) { return Results.Json(new { message = "Saved tracklist data could not be read. Nothing was replaced." }, statusCode: 422); }
    }
}
