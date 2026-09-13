using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Wisp.Api.Recordings;
using Wisp.Core.Recordings;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Tests;

public sealed partial class MixRecorderTests
{
    private sealed record FeedbackView(int Revision, string Notes, string Status, MixAnnotation[] Annotations, Guid[] DetachedAnnotationIds);
    private Task<HttpResponseMessage> SaveFeedback(Guid id, int revision, MixAnnotation[] annotations, string notes = "Review notes", string status = "Needs review", Guid? liveId = null) =>
        Client.PostAsJsonAsync($"/api/recording-feedback/{id}", new FeedbackEndpoints.SaveRequest(revision, notes, status, annotations, liveId));
    private async Task<FeedbackView> Feedback(Guid id) => (await Client.GetFromJsonAsync<FeedbackView>($"/api/recording-feedback/{id}"))!;
    private static MixAnnotation Note(double start = .1, double? end = null) => new(Guid.NewGuid(), start, end, "Practise this blend", "Transition", false, null, null);
    private async Task<RevisionPreview> Preview(Guid id, PlanRevisionRequest request)
    {
        var response = await Client.PostAsJsonAsync($"/api/recording-feedback/{id}/preview", request); response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<RevisionPreview>())!;
    }
    private Task<HttpResponseMessage> Revise(Guid id, PlanRevisionRequest request) => Client.PostAsJsonAsync($"/api/recording-feedback/{id}/revise", request);
    private async Task<PlanRevisionRequest> RevisionRequest(Guid id, string source = "blueprint")
    {
        var list = await List(id); var feedback = await Feedback(id);
        return new(Guid.NewGuid(), "Next attempt", source, source == "blueprint" ? list.ActiveSnapshotId : null, list.Revision, feedback.Revision,
            source == "blueprint" ? list.Snapshots.First(s => s.Id == list.ActiveSnapshotId).Blueprint.Entries.Select(e => new RevisionSelection(e.Id, e.TrackId, false)).ToArray() :
                list.Entries.Where(e => e.Played).Select(e => new RevisionSelection(e.Id, e.TrackId, false)).ToArray(), feedback.Annotations.Select(a => a.Id).ToArray(), true, false);
    }

    [Fact]
    public async Task Rating_and_feedback_save_atomically_without_overwriting_quick_markers()
    {
        var id = (await Record()).Id; var marker = new RecordingMarker(Guid.NewGuid(), .5, "Quick bookmark");
        (await Client.PostAsJsonAsync($"/api/recording-workspace/{id}/review", new WorkspaceEndpoints.ReviewRequest(0, 3, [marker]))).EnsureSuccessStatusCode();
        var request = new FeedbackEndpoints.SaveRequest(0, "My review", "Needs review", [Note()], Rating: 5, RatingRevision: 0);
        Assert.Equal(HttpStatusCode.Conflict, (await Client.PostAsJsonAsync($"/api/recording-feedback/{id}", request)).StatusCode);
        Assert.Equal(0, (await Feedback(id)).Revision);
        (await Client.PostAsJsonAsync($"/api/recording-feedback/{id}", request with { RatingRevision = 1 })).EnsureSuccessStatusCode();
        using var review = JsonDocument.Parse(await Client.GetStringAsync($"/api/recording-workspace/{id}/review"));
        Assert.Equal(5, review.RootElement.GetProperty("rating").GetInt32()); Assert.Equal(marker.Id, review.RootElement.GetProperty("markers")[0].GetProperty("id").GetGuid());
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.PostAsJsonAsync($"/api/recording-feedback/{id}", request with { Revision = 1, RatingRevision = 2, Rating = 6 })).StatusCode);
        Assert.Equal(1, (await Feedback(id)).Revision);
    }

    [Fact]
    public async Task Failed_revision_commit_is_atomic_and_foreign_or_duplicated_source_entries_are_rejected()
    {
        var id = (await Record()).Id; var plan = await SeedPlan(); (await Link(id, 0, plan.Id)).EnsureSuccessStatusCode();
        var request = await RevisionRequest(id); var preview = await Preview(id, request); request = request with { PreviewToken = preview.Token };
        Assert.Equal(HttpStatusCode.BadRequest, (await Revise(id, request with { Entries = [request.Entries[0], request.Entries[0]] })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Revise(id, request with { Entries = [new(Guid.NewGuid(), plan.Tracks[0].TrackId, false)] })).StatusCode);
        saveFault.FailPlanRevision = true;
        Assert.Equal(HttpStatusCode.Conflict, (await Revise(id, request)).StatusCode);
        using (var scope = app.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<WispDbContext>(); Assert.Equal(1, await db.MixPlans.CountAsync()); Assert.Empty(await db.RecordingPlanRevisions.ToArrayAsync()); }
        saveFault.FailPlanRevision = false; (await Revise(id, request)).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Feedback_edits_ranges_status_and_resolution_are_independent_of_rating_and_capture()
    {
        var id = (await Record()).Id; var note = Note(0, 1.2);
        (await SaveFeedback(id, 0, [note])).EnsureSuccessStatusCode();
        (await Client.PostAsJsonAsync($"/api/recording-workspace/{id}/review", new WorkspaceEndpoints.ReviewRequest(0, 5, []))).EnsureSuccessStatusCode();
        var saved = await Feedback(id); Assert.Equal("Needs review", saved.Status); Assert.Equal("Review notes", saved.Notes); Assert.Equal(note, Assert.Single(saved.Annotations));
        Assert.Equal(HttpStatusCode.Conflict, (await SaveFeedback(id, 0, [])).StatusCode);
        (await SaveFeedback(id, 1, [note with { Text = "Improved", Resolved = true }], "Overall improved", "Ready to share")).EnsureSuccessStatusCode();
        Assert.True((await Feedback(id)).Annotations[0].Resolved);
        (await SaveFeedback(id, 2, [], "", "Practice")).EnsureSuccessStatusCode(); Assert.Empty((await Feedback(id)).Annotations);
        using var rating = JsonDocument.Parse(await Client.GetStringAsync($"/api/recording-workspace/{id}/review")); Assert.Equal(5, rating.RootElement.GetProperty("rating").GetInt32());
    }

    [Fact]
    public async Task Association_text_survives_tracklist_removal_and_invalid_new_associations_are_rejected()
    {
        var id = (await Record()).Id; var a = Manual("A", 0); var b = Manual("B", .5);
        (await Entries(id, 0, [a, b])).EnsureSuccessStatusCode();
        var note = Note() with { OccurrenceId = a.Id, ToOccurrenceId = b.Id, AssociationLabel = "spoofed" };
        (await SaveFeedback(id, 0, [note])).EnsureSuccessStatusCode(); var saved = (await Feedback(id)).Annotations[0]; Assert.Contains("A → DJ — B", saved.AssociationLabel);
        (await Entries(id, 1, [a])).EnsureSuccessStatusCode();
        Assert.Equal(note.Id, Assert.Single((await Feedback(id)).DetachedAnnotationIds));
        (await SaveFeedback(id, 1, [saved with { Resolved = true }])).EnsureSuccessStatusCode(); Assert.Equal(saved.AssociationLabel, (await Feedback(id)).Annotations[0].AssociationLabel);
        Assert.Equal(HttpStatusCode.BadRequest, (await SaveFeedback(id, 2, [Note() with { OccurrenceId = b.Id }])).StatusCode);
        (await SaveFeedback(id, 2, [saved with { OccurrenceId = null, ToOccurrenceId = null }])).EnsureSuccessStatusCode(); Assert.Null((await Feedback(id)).Annotations[0].AssociationLabel);
    }

    [Fact]
    public async Task Live_comments_use_capture_clock_and_finalising_cannot_overwrite_feedback()
    {
        var id = Guid.NewGuid(); (await Start(id)).EnsureSuccessStatusCode(); await Until(() => recorder.Status.Session?.State == "Recording");
        devices.Last!.Emit(); devices.Last.Emit(); var note = Note(999, 1000);
        (await SaveFeedback(id, 0, [note], liveId: note.Id)).EnsureSuccessStatusCode();
        var saved = await Feedback(id); Assert.Equal(.2, saved.Annotations[0].Seconds); Assert.Null(saved.Annotations[0].EndSeconds);
        recorder.Stop(id); await Until(() => !recorder.Status.Busy); Assert.Equal(saved.Annotations, (await Feedback(id)).Annotations);
        var next = Note(); Assert.Equal(HttpStatusCode.Conflict, (await SaveFeedback(id, 1, [next], liveId: next.Id)).StatusCode);
    }

    [Fact]
    public async Task Blueprint_review_revision_then_second_take_preserves_first_take_and_parent_plan()
    {
        var parent = await SeedPlan(); var id = Guid.NewGuid(); (await Start(id, planId: parent.Id)).EnsureSuccessStatusCode(); await FinishCapture(id);
        var first = await List(id); var note = Note(0);
        (await SaveFeedback(id, 0, [note], "Try a smoother opening")).EnsureSuccessStatusCode();
        var request = await RevisionRequest(id); var preview = await Preview(id, request);
        Assert.Empty(preview.Problems); Assert.All(preview.Tracks, t => { Assert.Equal(12.5, t.CueInSeconds); Assert.True(t.IsAnchor); });
        Assert.Contains("NOT track cue points", preview.Notes); Assert.Contains("Practise this blend", preview.Notes);
        request = request with { PreviewToken = preview.Token }; (await Revise(id, request)).EnsureSuccessStatusCode(); (await Revise(id, request)).EnsureSuccessStatusCode();
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
            Assert.Equal(2, await db.MixPlans.CountAsync()); var child = await db.MixPlans.Include(p => p.Tracks).SingleAsync(p => p.Id == request.RequestId);
            Assert.Equal(3, child.Tracks.Count); Assert.Contains("Try a smoother opening", child.Notes); Assert.Equal("Warm-up", (await db.MixPlans.FindAsync(parent.Id))!.Notes);
            var lineage = await db.RecordingPlanRevisions.SingleAsync(); Assert.Equal(parent.Id, lineage.ParentPlanId); Assert.Contains(note.Text, lineage.ContextJson);
        }
        var second = Guid.NewGuid(); (await Start(second, id, request.RequestId)).EnsureSuccessStatusCode(); await FinishCapture(second);
        Assert.Equal("Next attempt", (await List(second)).Snapshots[0].PlanName);
        Assert.Equal(first.Snapshots[0].Blueprint.Entries, (await List(id)).Snapshots[0].Blueprint.Entries); Assert.Equal(note.Text, (await Feedback(id)).Annotations[0].Text);
        var origin = await Client.GetFromJsonAsync<JsonElement>($"/api/recording-feedback/plans/{request.RequestId}/origin"); Assert.Equal(id, origin.GetProperty("recordingId").GetGuid());
    }

    [Fact]
    public async Task Actual_revision_requires_draft_acknowledgement_and_manual_resolution_preserving_repeats()
    {
        var id = (await Record()).Id; var plan = await SeedPlan(); (await Link(id, 0, plan.Id)).EnsureSuccessStatusCode(); (await Copy(id, 1)).EnsureSuccessStatusCode();
        var list = await List(id); var actual = new[] { list.Entries[0] with { Played = true, StartSeconds = .2 }, Manual("Unreleased") with { Played = true }, list.Entries[1] };
        (await Entries(id, list.Revision, actual)).EnsureSuccessStatusCode(); var request = await RevisionRequest(id, "actual");
        var unresolved = await Preview(id, request); Assert.Equal(1, unresolved.ExcludedDrafts); Assert.Contains(unresolved.Problems, p => p.Contains("acknowledge")); Assert.Contains(unresolved.Problems, p => p.Contains("Unreleased"));
        Assert.Equal(HttpStatusCode.BadRequest, (await Revise(id, request with { PreviewToken = unresolved.Token })).StatusCode);
        request = request with { ExcludeDrafts = true, Entries = request.Entries.Select(e => e.SourceEntryId == actual[1].Id ? e with { TrackId = actual[0].TrackId } : e).ToArray() };
        var preview = await Preview(id, request); Assert.Empty(preview.Problems); Assert.Equal(2, preview.Tracks.Length);
        Assert.Equal(preview.Tracks[0].TrackId, preview.Tracks[1].TrackId); Assert.Null(preview.Tracks[1].CueInSeconds); Assert.False(preview.Tracks[1].IsAnchor);
        Assert.Null(preview.Tracks[0].TransitionNotes); Assert.Contains(preview.Warnings, w => w.Contains("next track changed"));
        (await Revise(id, request with { PreviewToken = preview.Token })).EnsureSuccessStatusCode();
        using var scope = app.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        var tracks = await db.MixPlanTracks.Where(t => t.MixPlanId == request.RequestId).ToArrayAsync(); Assert.Equal(2, tracks.Length); Assert.Equal(2, tracks.Select(t => t.Id).Distinct().Count());
        Assert.All(tracks, t => Assert.NotEqual(.2, t.CueInSeconds)); // No recording-relative entrance becomes a song cue.
    }

    [Fact]
    public async Task Preview_detects_stale_feedback_tracklists_and_library_metadata_before_creating()
    {
        var id = (await Record()).Id; var plan = await SeedPlan(); (await Link(id, 0, plan.Id)).EnsureSuccessStatusCode();
        var request = await RevisionRequest(id); var preview = await Preview(id, request);
        using (var scope = app.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<WispDbContext>(); (await db.Tracks.FindAsync(plan.Tracks[0].TrackId))!.Title = "Changed"; await db.SaveChangesAsync(); }
        Assert.Equal(HttpStatusCode.Conflict, (await Revise(id, request with { PreviewToken = preview.Token })).StatusCode);
        preview = await Preview(id, request); (await SaveFeedback(id, 0, [Note()])).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await Revise(id, request with { PreviewToken = preview.Token })).StatusCode);
        request = await RevisionRequest(id); preview = await Preview(id, request); (await Copy(id, 1)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await Revise(id, request with { PreviewToken = preview.Token })).StatusCode);
        using var checkScope = app.Services.CreateScope(); Assert.Empty(await checkScope.ServiceProvider.GetRequiredService<WispDbContext>().RecordingPlanRevisions.ToArrayAsync());
    }

    [Fact]
    public async Task Deleted_library_references_can_be_explicitly_omitted_and_invalid_cues_are_cleared()
    {
        var id = (await Record()).Id; var plan = await SeedPlan(); (await Link(id, 0, plan.Id)).EnsureSuccessStatusCode();
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WispDbContext>(); db.Tracks.Remove((await db.Tracks.FindAsync(plan.Tracks[0].TrackId))!);
            (await db.Tracks.FindAsync(plan.Tracks[1].TrackId))!.Duration = TimeSpan.FromSeconds(1); await db.SaveChangesAsync();
        }
        var request = await RevisionRequest(id); Assert.NotEmpty((await Preview(id, request)).Problems);
        request = request with { Entries = request.Entries.Select((e, i) => i == 0 ? e with { Omit = true } : e).ToArray() };
        var preview = await Preview(id, request); Assert.Empty(preview.Problems); Assert.Equal(2, preview.Tracks.Length); Assert.Null(preview.Tracks[0].CueInSeconds); Assert.NotEmpty(preview.Warnings);
        (await Revise(id, request with { PreviewToken = preview.Token })).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Deletion_and_downgrade_preserve_revision_lineage_without_recreating_deleted_plans_on_retry()
    {
        var id = (await Record()).Id; var plan = await SeedPlan(); (await Link(id, 0, plan.Id)).EnsureSuccessStatusCode();
        var request = await RevisionRequest(id); request = request with { PreviewToken = (await Preview(id, request)).Token }; (await Revise(id, request)).EnsureSuccessStatusCode();
        using var scope = app.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        db.MixPlans.Remove((await db.MixPlans.FindAsync(request.RequestId))!); db.MixPlans.Remove((await db.MixPlans.FindAsync(plan.Id))!); await db.SaveChangesAsync();
        var retry = await Revise(id, request); retry.EnsureSuccessStatusCode(); var json = await retry.Content.ReadFromJsonAsync<JsonElement>(); Assert.False(json.GetProperty("exists").GetBoolean());
        Assert.Equal(HttpStatusCode.Conflict, (await Revise(id, request with { Name = "Another" })).StatusCode);
        Assert.Equal(0, await db.MixPlans.CountAsync()); Assert.Single(await db.RecordingPlanRevisions.ToArrayAsync());
        var previous = db.Database.GetMigrations().TakeWhile(m => !m.EndsWith("_AddRecordingFeedback")).Last();
        await Assert.ThrowsAnyAsync<Exception>(() => db.GetService<IMigrator>().MigrateAsync(previous)); Assert.Single(await db.RecordingPlanRevisions.ToArrayAsync());
    }
}
