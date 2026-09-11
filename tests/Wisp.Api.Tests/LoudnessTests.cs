using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Wisp.Api.Library;
using Wisp.Api.Settings;
using Wisp.Core.Cues;
using Wisp.Core.Playlists;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.FileSystem;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;
using Wisp.Infrastructure.Tagging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Wisp.Api.Tests;

[Collection("Library file operations")]
public sealed class LoudnessTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wisp-loudness-api-" + Guid.NewGuid().ToString("N"));
    private readonly SqliteConnection _connection = new("Data Source=:memory:");
    private readonly Guid _id = Guid.NewGuid();
    private readonly Normalizer _normalizer = new();
    private WebApplication _app = null!;
    private HttpClient Client => _app.GetTestClient();
    private string Source => Path.Combine(_root, "original.wav");

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(_root); await File.WriteAllBytesAsync(Source, [1, 2, 3]);
        await _connection.OpenAsync();
        var builder = WebApplication.CreateBuilder(); builder.WebHost.UseTestServer();
        builder.Services.AddDbContext<WispDbContext>(o => o.UseSqlite(_connection));
        builder.Services.AddSingleton<ILoudnessNormalizer>(_normalizer);
        builder.Services.AddSingleton(new WispSettingsStore(Path.Combine(_root, "settings.json")));
        builder.Services.AddSingleton<IFileFingerprint, FileFingerprint>();
        builder.Services.AddSingleton<IAudioFileValidator, Validator>();
        builder.Services.AddSingleton<AiffTranscoder>();
        builder.Services.AddSingleton<IMetadataReader, MetadataReader>();
        _app = builder.Build(); _app.MapLoudness(); _app.MapTrackFiles();
        using var scope = _app.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        await db.Database.MigrateAsync();
        db.Tracks.Add(new Track { Id = _id, FilePath = Source, FileName = "original.wav", FileHash = "before", Title = "Curated title", Artist = "Artist", Duration = TimeSpan.FromSeconds(20), Notes = "Keep", Bpm = 128 });
        db.CuePoints.Add(new CuePoint { Id = Guid.NewGuid(), TrackId = _id, TimeSeconds = 10 });
        db.DeviceCues.Add(new DeviceCue { Id = Guid.NewGuid(), TrackId = _id, StartSeconds = 12 });
        db.Playlists.Add(new Playlist { Id = Guid.NewGuid(), Name = "Set", Tracks = [new PlaylistTrack { Id = Guid.NewGuid(), TrackId = _id }] });
        await db.SaveChangesAsync(); await _app.StartAsync();
    }

    private async Task<LoudnessState> Scan() => (await (await Client.PostAsJsonAsync($"/api/tracks/{_id}/loudness/scan", new { targetLufs = -14 })).Content.ReadFromJsonAsync<LoudnessState>())!;
    private Task<HttpResponseMessage> Create(Guid analysis, string? folder = null) => Client.PostAsJsonAsync($"/api/tracks/{_id}/loudness/create", new { analysisId = analysis, musicFolder = folder ?? _root });
    private Task<HttpResponseMessage> Switch(string version, string expected) => Client.PutAsJsonAsync($"/api/tracks/{_id}/loudness/version", new { version, expectedFilePath = expected });
    private async Task<LoudnessState> State() => (await Client.GetFromJsonAsync<LoudnessState>($"/api/tracks/{_id}/loudness"))!;

    [Fact]
    public async Task Creates_separate_copy_and_switches_both_ways_without_losing_track_identity_or_cues()
    {
        var scan = await Scan();
        Assert.Null(scan.Normalization); Assert.Equal(Source, scan.Track.FilePath);
        (await Create(scan.Analysis!.Id)).EnsureSuccessStatusCode();
        var created = await State(); var output = created.Normalization!.OutputPath;
        Assert.StartsWith(Path.Combine(_root, LoudnessNormalizer.FolderName), output);
        Assert.Equal(Source, created.Track.FilePath); Assert.True(created.Track.HasNormalizedVersion);
        Assert.Equal(new byte[] { 1, 2, 3 }, await File.ReadAllBytesAsync(Source));
        (await Switch("normalized", Source)).EnsureSuccessStatusCode();
        Assert.Equal("normalized", (await State()).Track.AudioVersion);
        using (var scope = _app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
            Assert.Equal(output, Assert.Single(new LibraryFileDrag(db).Resolve([_id])));
            Assert.Single(await db.Tracks.ToListAsync()); Assert.Equal(10, (await db.CuePoints.SingleAsync()).TimeSeconds);
            Assert.Equal(12, (await db.DeviceCues.SingleAsync()).StartSeconds);
            Assert.Equal(_id, (await db.PlaylistTracks.SingleAsync()).TrackId);
            Assert.Equal("Keep", (await db.Tracks.SingleAsync()).Notes);
        }
        (await Switch("original", output)).EnsureSuccessStatusCode();
        Assert.Equal(Source, (await State()).Track.FilePath); Assert.True(File.Exists(output));
    }

    [Fact]
    public async Task Rescan_does_not_import_inactive_original_or_generated_versions_as_duplicate_tracks()
    {
        var scan = await Scan(); (await Create(scan.Analysis!.Id)).EnsureSuccessStatusCode();
        (await Switch("normalized", Source)).EnsureSuccessStatusCode();
        using var scope = _app.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        var job = new ScanJob { Id = Guid.NewGuid(), FolderPath = _root, Status = ScanStatus.Pending };
        db.ScanJobs.Add(job); await db.SaveChangesAsync();
        var scanner = new LibraryScanner(db, new FileScanner(), new FileFingerprint(), new MetadataReader(), new ScanProgressBus(), NullLogger<LibraryScanner>.Instance);
        await scanner.RunAsync(new Wisp.Infrastructure.Library.ScanRequest(job.Id, _root), default);
        Assert.Equal(ScanStatus.Completed, job.Status); Assert.Equal(0, job.AddedTracks);
        var track = Assert.Single(await db.Tracks.ToListAsync()); Assert.False(track.IsUnavailable); Assert.Equal("Curated title", track.Title);
        Assert.Single(new FileScanner().EnumerateAudioFiles(_root));
    }

    [Fact]
    public async Task Changed_original_or_unknown_analysis_cannot_generate_from_stale_measurements()
    {
        Assert.Equal(HttpStatusCode.Conflict, (await Create(Guid.NewGuid())).StatusCode);
        var scan = await Scan(); await File.WriteAllBytesAsync(Source, [3, 2, 1]);
        Assert.Equal(HttpStatusCode.Conflict, (await Create(scan.Analysis!.Id)).StatusCode);
        Assert.Equal(0, _normalizer.Renders); Assert.Null((await State()).Normalization);
    }

    [Fact]
    public async Task Failed_render_removes_only_its_partial_output_and_retry_is_idempotent()
    {
        var scan = await Scan(); _normalizer.Fail = true;
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Create(scan.Analysis!.Id)).StatusCode);
        Assert.Empty(Directory.GetFiles(Path.Combine(_root, LoudnessNormalizer.FolderName), "*.wav", SearchOption.AllDirectories));
        Assert.Null((await State()).Normalization);
        _normalizer.Fail = false;
        (await Create(scan.Analysis.Id)).EnsureSuccessStatusCode();
        var output = (await State()).Normalization!.OutputPath;
        (await Create(scan.Analysis.Id)).EnsureSuccessStatusCode();
        Assert.Equal(output, (await State()).Normalization!.OutputPath); Assert.Equal(2, _normalizer.Renders);
        Assert.Equal(new byte[] { 1, 2, 3 }, await File.ReadAllBytesAsync(Source));
    }

    [Fact]
    public async Task Version_switch_rejects_changed_missing_or_stale_links_and_relink_clears_lineage()
    {
        var scan = await Scan(); (await Create(scan.Analysis!.Id)).EnsureSuccessStatusCode();
        var output = (await State()).Normalization!.OutputPath;
        Assert.Equal(HttpStatusCode.Conflict, (await Switch("normalized", "wrong")).StatusCode);
        await File.WriteAllBytesAsync(output, [9, 9, 9]);
        Assert.Equal(HttpStatusCode.Conflict, (await Switch("normalized", Source)).StatusCode);
        Assert.Equal(Source, (await State()).Track.FilePath);
        File.Delete(output);
        Assert.Equal(HttpStatusCode.Conflict, (await Switch("normalized", Source)).StatusCode);
        var replacement = Path.Combine(_root, "replacement.wav"); await File.WriteAllBytesAsync(replacement, [1, 3, 4]);
        (await Client.PutAsJsonAsync($"/api/tracks/{_id}/file", new { filePath = replacement, expectedFilePath = Source })).EnsureSuccessStatusCode();
        var state = await State(); Assert.Null(state.Normalization); Assert.Null(state.Analysis); Assert.False(state.Track.HasNormalizedVersion);
        Assert.True(File.Exists(Source));
    }

    [Fact]
    public async Task Invalid_targets_folders_and_busy_operations_do_not_write_files()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.PostAsJsonAsync($"/api/tracks/{_id}/loudness/scan", new { targetLufs = 0 })).StatusCode);
        var scan = await Scan();
        Assert.Equal(HttpStatusCode.BadRequest, (await Create(scan.Analysis!.Id, "relative")).StatusCode);
        await LibraryFileGate.Instance.WaitAsync();
        try { Assert.Equal(HttpStatusCode.Conflict, (await Create(scan.Analysis.Id)).StatusCode); }
        finally { LibraryFileGate.Instance.Release(); }
        Assert.Equal(0, _normalizer.Renders);
    }

    private sealed class Validator : IAudioFileValidator
    { public Task<TimeSpan> ValidateAsync(string path, CancellationToken ct) => Task.FromResult(TimeSpan.FromSeconds(20)); }

    [Fact]
    public async Task Regeneration_keeps_prior_outputs_and_status_persists_analysis_and_version_metadata()
    {
        var firstScan = await Scan(); (await Create(firstScan.Analysis!.Id)).EnsureSuccessStatusCode();
        var first = (await State()).Normalization!.OutputPath;
        var nextScan = await Scan(); (await Create(nextScan.Analysis!.Id)).EnsureSuccessStatusCode();
        var next = (await State()).Normalization!.OutputPath;
        Assert.NotEqual(first, next); Assert.True(File.Exists(first)); Assert.True(File.Exists(next));
        var response = await Client.PostAsJsonAsync("/api/loudness/status", new { trackIds = new[] { _id, _id } });
        var row = Assert.Single((await response.Content.ReadFromJsonAsync<LoudnessState[]>())!);
        Assert.Equal(nextScan.Analysis.Id, row.Analysis!.Id); Assert.Equal(next, row.Normalization!.OutputPath);
        Assert.Equal("Curated title", row.Track.Title); Assert.Equal(128, row.Track.Bpm); Assert.False(row.AnalysisStale);
        var settings = _app.Services.GetRequiredService<WispSettingsStore>();
        Assert.Equal(_root, settings.Current.NormalizationMusicFolder);
    }

    [Fact]
    public async Task Downgrade_refuses_to_drop_original_link_while_normalized_copy_is_active()
    {
        var scan = await Scan(); (await Create(scan.Analysis!.Id)).EnsureSuccessStatusCode();
        (await Switch("normalized", Source)).EnsureSuccessStatusCode();
        using var scope = _app.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        var migrator = db.GetService<IMigrator>();
        await Assert.ThrowsAsync<SqliteException>(() => migrator.MigrateAsync("20260911150947_AllowRepeatedPlaylistEntries"));
        Assert.Equal(Source, (await db.Tracks.SingleAsync()).OriginalFilePath);
    }

    private sealed class Normalizer : ILoudnessNormalizer
    {
        public bool IsAvailable => true;
        public bool Fail; public int Renders;
        public Task<LoudnessMeasurement> MeasureAsync(string source, double target, CancellationToken ct) => Task.FromResult(new LoudnessMeasurement(-22, -9, 5, -32, 0, 20));
        public async Task<LoudnessRender> RenderAsync(string source, string output, LoudnessMeasurement measured, double target, bool allowLimiting, IReadOnlyDictionary<string, string> metadata, CancellationToken ct)
        {
            Renders++; await File.WriteAllBytesAsync(output, [4, 5, 6], ct);
            if (Fail) throw new TranscodeException("Simulated render failure");
            return new(new(-14, -1.2, 5, -24, 0, 20), 8, false);
        }
    }
    public async Task DisposeAsync() { await _app.DisposeAsync(); await _connection.DisposeAsync(); Directory.Delete(_root, true); }
}
