using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using NAudio.Wave;
using Wisp.Api.Recordings;
using Wisp.Core.MixPlans;
using Wisp.Core.Recordings;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Tests;

public sealed partial class MixRecorderTests
{
    public sealed record SnapshotView(Guid Id, Guid SourcePlanId, string PlanName, string Timing, bool SourceExists, Blueprint Blueprint);
    public sealed record TracklistView(int Revision, Guid? ActiveSnapshotId, PerformedEntry[] Entries, SnapshotView[] Snapshots, bool TimesDisagree, Guid[] MissingTrackIds);
    private async Task<TracklistView> List(Guid id) => (await Client.GetFromJsonAsync<TracklistView>($"/api/recording-tracklists/{id}"))!;
    private Task<HttpResponseMessage> Entries(Guid id, int revision, PerformedEntry[] entries, Guid? liveEntryId = null) => Client.PostAsJsonAsync($"/api/recording-tracklists/{id}/entries", new { revision, entries, liveEntryId });
    private Task<HttpResponseMessage> Link(Guid id, int revision, Guid planId, Guid? snapshotId = null) => Client.PostAsJsonAsync($"/api/recording-tracklists/{id}/link", new { revision, planId, snapshotId = snapshotId ?? Guid.NewGuid() });
    private Task<HttpResponseMessage> Copy(Guid id, int revision) => Client.PostAsJsonAsync($"/api/recording-tracklists/{id}/copy", new { revision });
    private static PerformedEntry Manual(string title, double? time = null) => new(Guid.NewGuid(), null, "DJ", title, time.HasValue, time, null);
    private async Task<MixPlan> SeedPlan()
    {
        using var scope = app.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        var plan = new MixPlan { Id = Guid.NewGuid(), Name = "Blueprint", Notes = "Warm-up", UpdatedAt = DateTime.UtcNow };
        foreach (var name in new[] { "A", "B", "C" })
        {
            var track = new Track { Id = Guid.NewGuid(), FilePath = Path.Combine(root, name + ".wav"), FileName = name + ".wav", FileHash = name, Artist = "Artist", Title = name, Bpm = 128, MusicalKey = "8A" };
            db.Tracks.Add(track);
            plan.Tracks.Add(new MixPlanTrack { Id = Guid.NewGuid(), TrackId = track.Id, Track = track, Order = plan.Tracks.Count, CueInSeconds = 12.5, TransitionNotes = "Blend", IsAnchor = true });
        }
        db.MixPlans.Add(plan); await db.SaveChangesAsync(); return plan;
    }
    private async Task FinishCapture(Guid id)
    {
        await Until(() => recorder.Status.Session?.State == "Recording"); devices.Last!.Emit();
        recorder.Stop(id); await Until(() => !recorder.Status.Busy); Assert.Equal("Ready", recorder.Status.Session!.State);
    }

    [Fact]
    public async Task Start_snapshots_atomically_and_later_plan_edits_only_affect_new_takes()
    {
        var plan = await SeedPlan(); var id = Guid.NewGuid();
        (await Start(id, planId: plan.Id)).EnsureSuccessStatusCode();
        (await Start(id, planId: plan.Id)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await Start(id)).StatusCode);
        var initial = await List(id); Assert.Empty(initial.Entries); var snapshot = Assert.Single(initial.Snapshots);
        Assert.Equal("At recording start", snapshot.Timing); Assert.Equal("Warm-up", snapshot.Blueprint.Notes);
        Assert.Equal(new[] { "A", "B", "C" }, snapshot.Blueprint.Entries.Select(e => e.Title));
        Assert.All(snapshot.Blueprint.Entries, e => { Assert.Equal(128m, e.Bpm); Assert.Equal("8A", e.MusicalKey); Assert.Equal(12.5, e.CueInSeconds); Assert.Equal("Blend", e.TransitionNotes); Assert.True(e.IsAnchor); });
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WispDbContext>(); var current = await db.MixPlans.FindAsync(plan.Id);
            current!.Name = "Revised"; current.Notes = "Changed"; (await db.Tracks.FindAsync(plan.Tracks[0].TrackId))!.Title = "Changed A";
            (await db.MixPlanTracks.FindAsync(plan.Tracks[0].Id))!.Order = 99; await db.SaveChangesAsync();
        }
        await FinishCapture(id);
        Assert.Equal("A", (await List(id)).Snapshots[0].Blueprint.Entries[0].Title);
        var second = Guid.NewGuid(); (await Start(second, id, plan.Id)).EnsureSuccessStatusCode(); await FinishCapture(second);
        Assert.Equal("Revised", (await List(second)).Snapshots[0].PlanName);
        Assert.Equal(new[] { "B", "C", "Changed A" }, (await List(second)).Snapshots[0].Blueprint.Entries.Select(e => e.Title));
        Assert.NotEqual(initial.ActiveSnapshotId, (await List(second)).ActiveSnapshotId);
    }

    [Fact]
    public async Task Invalid_plan_and_failed_database_save_do_not_start_or_partially_register_capture()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await Start(Guid.NewGuid(), planId: Guid.NewGuid())).StatusCode);
        var plan = await SeedPlan(); saveFault.FailNextSessionSave = true;
        // Match the fixture's injected save failure through the coordinator, avoiding HTTP exception translation.
        await Assert.ThrowsAnyAsync<Exception>(() => recorder.Start(Guid.NewGuid(), "Practice", root, "stereo", null, plan.Id));
        using var scope = app.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        Assert.Empty(await db.RecordingSessions.ToArrayAsync()); Assert.Empty(await db.RecordingPlanSnapshots.ToArrayAsync());
        Assert.Equal(0, devices.OpenCount); Assert.False(recorder.Status.Busy);
    }

    [Fact]
    public async Task Actual_A_X_C_can_replace_draft_B_without_changing_blueprint_or_review_markers()
    {
        var session = await Record(); var plan = await SeedPlan(); var id = session.Id;
        (await Link(id, 0, plan.Id)).EnsureSuccessStatusCode(); (await Copy(id, 1)).EnsureSuccessStatusCode();
        var copied = await List(id); Assert.All(copied.Entries, e => { Assert.False(e.Played); Assert.Null(e.StartSeconds); });
        Assert.Equal(HttpStatusCode.Conflict, (await Copy(id, copied.Revision)).StatusCode);
        var actual = new[] { copied.Entries[0] with { Played = true, StartSeconds = 0 }, Manual("X", .4), copied.Entries[2] with { Played = true, StartSeconds = .9 } };
        (await Entries(id, copied.Revision, actual)).EnsureSuccessStatusCode();
        var saved = await List(id); Assert.Equal(new[] { "A", "X", "C" }, saved.Entries.Select(e => e.Title));
        Assert.Equal(new[] { "A", "B", "C" }, saved.Snapshots[0].Blueprint.Entries.Select(e => e.Title));
        Assert.Equal(HttpStatusCode.Conflict, (await Entries(id, copied.Revision, [])).StatusCode);
        using var review = JsonDocument.Parse(await Client.GetStringAsync($"/api/recording-workspace/{id}/review"));
        Assert.Equal(0, review.RootElement.GetProperty("markers").GetArrayLength());
    }

    [Fact]
    public async Task Relinking_unlinking_and_deleting_sources_preserve_historical_text_and_actual_entries()
    {
        var session = await Record(); var plan = await SeedPlan(); var id = session.Id; var request = Guid.NewGuid();
        (await Link(id, 0, plan.Id, request)).EnsureSuccessStatusCode(); (await Link(id, 0, plan.Id, request)).EnsureSuccessStatusCode();
        (await Copy(id, 1)).EnsureSuccessStatusCode(); var original = await List(id);
        (await Link(id, 2, plan.Id)).EnsureSuccessStatusCode();
        (await Client.PostAsJsonAsync($"/api/recording-tracklists/{id}/unlink", new { revision = 3 })).EnsureSuccessStatusCode();
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WispDbContext>(); db.MixPlans.Remove((await db.MixPlans.FindAsync(plan.Id))!);
            db.Tracks.RemoveRange(await db.Tracks.ToArrayAsync()); await db.SaveChangesAsync();
        }
        var retained = await List(id); Assert.Null(retained.ActiveSnapshotId); Assert.Equal(2, retained.Snapshots.Length);
        Assert.All(retained.Snapshots, s => { Assert.False(s.SourceExists); Assert.Equal("Linked after recording started", s.Timing); });
        Assert.Equal(original.Entries, retained.Entries); Assert.Equal(3, retained.MissingTrackIds.Length);
        (await Entries(id, retained.Revision, retained.Entries.Select(e => e with { Played = true }).ToArray())).EnsureSuccessStatusCode();
        var takes = await Client.GetFromJsonAsync<JsonElement[]>($"/api/recording-tracklists/plans/{plan.Id}/recordings"); Assert.Single(takes!);
        (await Client.PostAsJsonAsync($"/api/recordings/{id}/remove", new { deleteAudio = false, confirmed = true })).EnsureSuccessStatusCode();
        Assert.Empty((await Client.GetFromJsonAsync<JsonElement[]>($"/api/recording-tracklists/plans/{plan.Id}/recordings"))!);
        using var checkScope = app.Services.CreateScope(); Assert.Equal(2, await checkScope.ServiceProvider.GetRequiredService<WispDbContext>().RecordingPlanSnapshots.CountAsync());
    }

    [Fact]
    public async Task Standalone_occurrences_allow_repeats_untimed_confirmation_equal_starts_and_explicit_reordering()
    {
        var id = (await Record()).Id;
        var entries = new[] { Manual("Repeat", .8), Manual("Repeat", .2), Manual("Repeat", .2), Manual("Untimed") with { Played = true } };
        (await Entries(id, 0, entries)).EnsureSuccessStatusCode();
        var saved = await List(id); Assert.True(saved.TimesDisagree); Assert.Empty(saved.Snapshots);
        (await Entries(id, saved.Revision, entries.OrderBy(e => e.StartSeconds ?? double.PositiveInfinity).ToArray())).EnsureSuccessStatusCode();
        var sorted = await List(id); Assert.False(sorted.TimesDisagree);
        var cleared = sorted.Entries.Select(e => e with { StartSeconds = null }).ToArray();
        (await Entries(id, sorted.Revision, cleared)).EnsureSuccessStatusCode(); Assert.All((await List(id)).Entries, e => Assert.True(e.Played));
        Assert.Equal(HttpStatusCode.BadRequest, (await Entries(id, 3, [Manual("Beyond end", 10)])).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Entries(id, 3, [entries[0] with { Played = false }])).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Entries(id, 3, [entries[0], entries[0]])).StatusCode);
    }

    [Fact]
    public async Task Library_source_validation_and_foreign_blueprint_identity_cannot_be_spoofed()
    {
        var id = (await Record()).Id; var plan = await SeedPlan(); var track = plan.Tracks[0].Track!;
        var entry = Manual(track.Title!) with { TrackId = track.Id };
        (await Entries(id, 0, [entry])).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await Entries(id, 1, [entry with { TrackId = null }])).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Entries(id, 1, [Manual("Missing") with { TrackId = Guid.NewGuid() }])).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Entries(id, 1, [entry with { BlueprintEntryId = Guid.NewGuid() }])).StatusCode);
        var matches = await Client.GetFromJsonAsync<JsonElement[]>("/api/recording-tracklists/library?q=artist"); Assert.Equal(3, matches!.Length);
        Assert.Empty((await Client.GetFromJsonAsync<JsonElement[]>("/api/recording-tracklists/library?q="))!);
    }

    [Fact]
    public async Task Live_track_start_uses_captured_frames_and_survives_capture_finalisation()
    {
        var id = Guid.NewGuid(); (await Start(id)).EnsureSuccessStatusCode(); await Until(() => recorder.Status.Session?.State == "Recording");
        devices.Last!.Emit(); devices.Last.Emit();
        var entry = Manual("Improvised");
        (await Entries(id, 0, [entry], entry.Id)).EnsureSuccessStatusCode();
        var saved = await List(id); Assert.Equal(.2, saved.Entries[0].StartSeconds); Assert.True(saved.Entries[0].Played);
        recorder.Stop(id); await Until(() => !recorder.Status.Busy);
        Assert.Equal(saved.Entries, (await List(id)).Entries);
        Assert.Equal(HttpStatusCode.Conflict, (await Entries(id, saved.Revision, saved.Entries, entry.Id)).StatusCode);
    }

    [Fact]
    public async Task Import_can_link_later_and_deleting_recording_audio_does_not_delete_the_plan()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("WISP_TEST_FFMPEG"))) return;
        var source = Path.Combine(root, "standalone-import.wav");
        using (var writer = new WaveFileWriter(source, WaveFormat.CreateIeeeFloatWaveFormat(8000, 2)))
            for (var n = 0; n < 8000; n++) { writer.WriteSample(.1f); writer.WriteSample(-.1f); }
        var workspace = app.Services.GetRequiredService<RecordingWorkspace>(); var id = Guid.NewGuid();
        workspace.Import(id, source, root); await Until(() => workspace.Status?.State != "Running"); Assert.Equal("Ready", workspace.Status!.State);
        (await Entries(id, 0, [Manual("Spontaneous", .5)])).EnsureSuccessStatusCode();
        var plan = await SeedPlan(); (await Link(id, 1, plan.Id)).EnsureSuccessStatusCode();
        var linked = await List(id); Assert.Equal("Linked after recording started", linked.Snapshots[0].Timing);
        Assert.Equal("Spontaneous", linked.Entries[0].Title);
        (await Client.PostAsJsonAsync($"/api/recordings/{id}/remove", new { deleteAudio = true, confirmed = true })).EnsureSuccessStatusCode();
        using var scope = app.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        Assert.True(await db.MixPlans.AnyAsync(p => p.Id == plan.Id)); Assert.Single(await db.RecordingPlanSnapshots.ToArrayAsync()); Assert.True(File.Exists(source));
    }

    [Fact]
    public async Task Repeated_plan_tracks_copy_as_distinct_occurrences_and_downgrade_refuses_history_loss()
    {
        var plan = await SeedPlan();
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
            db.MixPlanTracks.Add(new() { Id = Guid.NewGuid(), MixPlanId = plan.Id, TrackId = plan.Tracks[0].TrackId, Order = 3 }); await db.SaveChangesAsync();
        }
        var id = (await Record()).Id; (await Link(id, 0, plan.Id)).EnsureSuccessStatusCode(); (await Copy(id, 1)).EnsureSuccessStatusCode();
        var copied = await List(id); Assert.Equal(4, copied.Entries.Select(e => e.Id).Distinct().Count());
        Assert.Equal(copied.Entries[0].TrackId, copied.Entries[3].TrackId); Assert.NotEqual(copied.Entries[0].BlueprintEntryId, copied.Entries[3].BlueprintEntryId);
        using var checkScope = app.Services.CreateScope(); var check = checkScope.ServiceProvider.GetRequiredService<WispDbContext>();
        var previous = check.Database.GetMigrations().Reverse().Skip(1).First();
        await Assert.ThrowsAnyAsync<Exception>(() => check.GetService<IMigrator>().MigrateAsync(previous));
        Assert.Single(await check.RecordingPlanSnapshots.ToArrayAsync()); Assert.Single(await check.RecordingTracklists.ToArrayAsync());
    }
}
