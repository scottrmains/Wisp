using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NAudio.Wave;
using Wisp.Api.Library;
using Wisp.Core.Cues;
using Wisp.Core.Playlists;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Tests;

[Collection("Library file operations")]
public sealed class MusicAnalysisTests : IAsyncLifetime
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "wisp-music-api-" + Guid.NewGuid().ToString("N"));
    private readonly SqliteConnection connection = new("Data Source=:memory:");
    private readonly Analyzer analyzer = new();
    private WebApplication app = null!;
    private readonly Guid id = Guid.NewGuid();
    private string Source => Path.Combine(root, "track.wav");
    private HttpClient Client => app.GetTestClient();
    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(root);
        using (var writer = new WaveFileWriter(Source, WaveFormat.CreateIeeeFloatWaveFormat(44100, 1)))
            for (var i = 0; i < 44100; i++) writer.WriteSample(0.1f);
        await connection.OpenAsync();
        var builder = WebApplication.CreateBuilder(); builder.WebHost.UseTestServer();
        builder.Services.AddDbContext<WispDbContext>(o => o.UseSqlite(connection));
        builder.Services.AddSingleton<IMusicAnalyzer>(analyzer);
        builder.Services.AddSingleton<MusicAnalysisJobs>();
        builder.Services.AddHostedService(sp => sp.GetRequiredService<MusicAnalysisJobs>());
        app = builder.Build(); app.MapMusicAnalysis();
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WispDbContext>(); await db.Database.MigrateAsync();
            db.Tracks.Add(new Track { Id = id, FilePath = Source, FileName = "track.wav", FileHash = "hash", Title = "Test", Version = "Dub", Notes = "Keep" });
            db.CuePoints.Add(new CuePoint { Id = Guid.NewGuid(), TrackId = id, TimeSeconds = 10 });
            db.DeviceCues.Add(new DeviceCue { Id = Guid.NewGuid(), TrackId = id, StartSeconds = 12 });
            db.Playlists.Add(new Playlist { Id = Guid.NewGuid(), Name = "Set", Tracks = [new PlaylistTrack { Id = Guid.NewGuid(), TrackId = id }] });
            await db.SaveChangesAsync();
        }
        await app.StartAsync();
    }
    private async Task Edit(Action<Track> edit)
    {
        using var scope = app.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        edit(await db.Tracks.SingleAsync()); await db.SaveChangesAsync();
    }
    private async Task<Track> Track()
    {
        using var scope = app.Services.CreateScope(); return await scope.ServiceProvider.GetRequiredService<WispDbContext>().Tracks.AsNoTracking().SingleAsync(t => t.Id == id);
    }
    private async Task<MusicAnalysisJob> Start(bool bpm = true, bool key = true, bool compare = false, Guid[]? ids = null)
    {
        var response = await Client.PostAsJsonAsync("/api/audio-analysis/jobs", new MusicAnalysisRequest(ids ?? [id], bpm, key, compare));
        response.EnsureSuccessStatusCode(); return (await response.Content.ReadFromJsonAsync<MusicAnalysisJob>())!;
    }
    private async Task<MusicAnalysisJob> Wait(Guid jobId)
    {
        for (var i = 0; i < 1000; i++)
        {
            var job = (await Client.GetFromJsonAsync<MusicAnalysisJob>($"/api/audio-analysis/jobs/{jobId}"))!;
            if (job.Status is "completed" or "cancelled") return job;
            await Task.Delay(10);
        }
        throw new TimeoutException("Analysis job did not finish");
    }
    private Task<HttpResponseMessage> Apply(Guid job, decimal? bpm = 128.37m, string? key = "8A") =>
        Client.PostAsJsonAsync($"/api/audio-analysis/jobs/{job}/tracks/{id}/apply", new MusicAnalysisApply(bpm, key));

    [Fact]
    public async Task Suggestions_are_separate_then_apply_updates_only_missing_fields_and_records_provenance()
    {
        var bytes = await File.ReadAllBytesAsync(Source);
        var job = await Wait((await Start(ids: [id, id])).Id);
        Assert.Single(job.Rows); Assert.Contains("Dub", job.Rows[0].Title);
        Assert.Null((await Track()).Bpm); Assert.Null((await Track()).MusicalKey);
        (await Apply(job.Id)).EnsureSuccessStatusCode(); var track = await Track();
        Assert.Equal(128.37m, track.Bpm); Assert.Equal("8A", track.MusicalKey);
        var stored = MusicAnalysisJobs.Read(track.MusicAnalysisJson)!;
        Assert.Equal(128.37m, stored.AppliedBpm); Assert.Equal("8A", stored.AppliedKey); Assert.NotNull(stored.AppliedAt);
        Assert.Equal(bytes, await File.ReadAllBytesAsync(Source)); Assert.Equal("Keep", track.Notes);
        using var scope = app.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        Assert.Equal(10, (await db.CuePoints.SingleAsync()).TimeSeconds); Assert.Equal(12, (await db.DeviceCues.SingleAsync()).StartSeconds);
        Assert.Equal(id, (await db.PlaylistTracks.SingleAsync()).TrackId);
        (await Apply(job.Id, 120, "8A")).EnsureSuccessStatusCode(); Assert.Equal(128.37m, (await Track()).Bpm);
    }

    [Theory]
    [InlineData(true, false)] [InlineData(false, true)] [InlineData(true, true)]
    public async Task Existing_values_are_skipped_independently(bool existingBpm, bool existingKey)
    {
        await Edit(t => { t.Bpm = existingBpm ? 125 : null; t.MusicalKey = existingKey ? "F# minor" : null; });
        var job = await Wait((await Start()).Id); var row = Assert.Single(job.Rows);
        if (existingBpm && existingKey) { Assert.Equal("skipped", row.Status); Assert.Empty(analyzer.Calls); }
        else { Assert.Equal((!existingBpm, !existingKey), Assert.Single(analyzer.Calls)); }
        var t = await Track(); Assert.Equal(existingBpm ? 125m : null, t.Bpm); Assert.Equal(existingKey ? "F# minor" : null, t.MusicalKey);
    }

    [Fact]
    public async Task Populated_database_fields_skip_even_when_drive_is_disconnected()
    {
        await Edit(t => { t.Bpm = 125; t.MusicalKey = "Unknown user key"; t.FilePath = Path.Combine(root, "missing.wav"); });
        var job = await Wait((await Start()).Id); Assert.Equal("skipped", job.Rows[0].Status); Assert.Empty(analyzer.Calls);
    }

    [Fact]
    public async Task Newly_written_external_tags_are_preserved_without_running_DSP()
    {
        using (var media = TagLib.File.Create(Source))
        { var tag = media.GetTag(TagLib.TagTypes.Id3v2, true); tag.BeatsPerMinute = 124; tag.InitialKey = "Gm"; media.Save(); }
        var job = await Wait((await Start()).Id);
        Assert.Equal("skipped", job.Rows[0].Status); Assert.Empty(analyzer.Calls);
        Assert.Equal(124, job.Rows[0].ExistingBpm); Assert.Equal("Gm", job.Rows[0].ExistingKey);
        Assert.Contains("Rescan", job.Rows[0].Message);
    }

    [Fact]
    public async Task Comparison_analyzes_both_but_cannot_replace_either_existing_value()
    {
        await Edit(t => { t.Bpm = 125; t.MusicalKey = "7A"; });
        var job = await Wait((await Start(compare: true)).Id); Assert.Equal((true, true), Assert.Single(analyzer.Calls));
        Assert.Equal(125, job.Rows[0].ExistingBpm); Assert.Equal("7A", job.Rows[0].ExistingKey);
        (await Apply(job.Id)).EnsureSuccessStatusCode(); var track = await Track();
        Assert.Equal(125, track.Bpm); Assert.Equal("7A", track.MusicalKey);
    }

    [Fact]
    public async Task Repeated_analysis_reuses_saved_suggestions_but_changed_bytes_invalidate_them()
    {
        var first = await Wait((await Start()).Id);
        var second = await Wait((await Start()).Id);
        Assert.False(first.Rows[0].Cached); Assert.True(second.Rows[0].Cached); Assert.Single(analyzer.Calls);
        using (var media = TagLib.File.Create(Source)) { media.Tag.Title = "Retagged"; media.Save(); }
        var third = await Wait((await Start()).Id); Assert.False(third.Rows[0].Cached); Assert.Equal(2, analyzer.Calls.Count);
    }

    [Fact]
    public async Task Cancel_stops_current_track_and_does_not_start_remaining_tracks_or_save_results()
    {
        analyzer.Hold = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var other = Guid.NewGuid();
        using (var scope = app.Services.CreateScope())
        { var db = scope.ServiceProvider.GetRequiredService<WispDbContext>(); db.Tracks.Add(new Track { Id = other, FilePath = Path.Combine(root, "other.wav"), FileName = "other.wav", FileHash = "other" }); await db.SaveChangesAsync(); }
        var job = await Start(ids: [id, other]); await analyzer.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(HttpStatusCode.Conflict, (await Client.PostAsJsonAsync("/api/audio-analysis/jobs", new MusicAnalysisRequest([id]))).StatusCode);
        (await Client.PostAsync($"/api/audio-analysis/jobs/{job.Id}/cancel", null)).EnsureSuccessStatusCode();
        var finished = await Wait(job.Id); Assert.Equal("cancelled", finished.Status);
        Assert.All(finished.Rows, r => Assert.Equal("cancelled", r.Status)); Assert.Single(analyzer.Calls);
        Assert.Null((await Track()).MusicAnalysisJson);
    }

    [Fact]
    public async Task Edits_during_analysis_are_rechecked_and_apply_is_per_field()
    {
        analyzer.Hold = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var job = await Start(); await analyzer.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await Edit(t => t.Bpm = 132); analyzer.Hold.SetResult(); await Wait(job.Id);
        (await Apply(job.Id)).EnsureSuccessStatusCode(); var track = await Track();
        Assert.Equal(132, track.Bpm); Assert.Equal("8A", track.MusicalKey);
        Assert.Null(MusicAnalysisJobs.Read(track.MusicAnalysisJson)!.AppliedBpm);
    }

    [Theory]
    [InlineData(false)] [InlineData(true)]
    public async Task Changed_file_or_link_blocks_stale_apply(bool relink)
    {
        var job = await Wait((await Start()).Id);
        if (relink) await Edit(t => t.FilePath = Path.Combine(root, "relinked.wav"));
        else using (var media = TagLib.File.Create(Source)) { media.Tag.Title = "Updated outside WISP"; media.Save(); }
        Assert.Equal(HttpStatusCode.Conflict, (await Apply(job.Id)).StatusCode); Assert.Null((await Track()).Bpm);
    }

    [Fact]
    public async Task Unsupported_inputs_are_rejected_and_field_selection_is_enforced()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.PostAsJsonAsync("/api/audio-analysis/jobs", new MusicAnalysisRequest([], false, false))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Client.PostAsJsonAsync("/api/audio-analysis/jobs", new MusicAnalysisRequest([Guid.NewGuid()]))).StatusCode);
        var job = await Wait((await Start(key: false)).Id); Assert.Equal((true, false), Assert.Single(analyzer.Calls));
        Assert.Equal(HttpStatusCode.BadRequest, (await Apply(job.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Apply(job.Id, 401, null)).StatusCode);
        (await Apply(job.Id, 128.375m, null)).EnsureSuccessStatusCode(); Assert.Equal(128.38m, (await Track()).Bpm);
    }

    [Fact]
    public async Task One_failed_file_does_not_fail_the_whole_job_and_can_be_retried()
    {
        analyzer.Fail = true; var job = await Wait((await Start()).Id);
        Assert.Equal("failed", job.Rows[0].Status); Assert.Null((await Track()).MusicAnalysisJson);
        analyzer.Fail = false; Assert.Equal("review", (await Wait((await Start()).Id)).Rows[0].Status);
    }

    private sealed class Analyzer : IMusicAnalyzer
    {
        public bool IsAvailable => true;
        public List<(bool Bpm, bool Key)> Calls { get; } = [];
        public TaskCompletionSource? Hold;
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool Fail;
        public async Task<MusicAnalysis> AnalyzeAsync(string path, bool bpm, bool key, CancellationToken ct)
        {
            Calls.Add((bpm, key)); Started.TrySetResult();
            if (Hold is not null) await Hold.Task.WaitAsync(ct);
            if (Fail) throw new IOException("Test decoder failure");
            return new(bpm ? 128.37m : null, key ? "8A" : null, .9, .8, false, false, 30, MusicFeatures.Engine);
        }
    }
    public async Task DisposeAsync()
    { await app.StopAsync(); await app.DisposeAsync(); await connection.DisposeAsync(); Directory.Delete(root, true); }
}
