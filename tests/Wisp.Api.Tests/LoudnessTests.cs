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

    [Theory]
    [InlineData(-13.59, 0.28, -14, false, "no_change")]
    [InlineData(-13.59, 0.28, -8, false, "limiting_required")]
    [InlineData(-7, 1, -8, true, "no_change")]
    public async Task Default_boost_only_rejects_quieter_copies_and_noops_on_server(double input, double peak, double target, bool limiting, string code)
    {
        _normalizer.Input = new(input, peak, 3.4, input - 10, 0, 20);
        var scanResponse = await Client.PostAsJsonAsync($"/api/tracks/{_id}/loudness/scan", new { targetLufs = target });
        scanResponse.EnsureSuccessStatusCode();
        var scan = (await scanResponse.Content.ReadFromJsonAsync<LoudnessState>())!;
        var response = await Client.PostAsJsonAsync($"/api/tracks/{_id}/loudness/create", new { analysisId = scan.Analysis!.Id, musicFolder = _root, allowLimiting = limiting });
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains(code, await response.Content.ReadAsStringAsync());
        Assert.Equal(0, _normalizer.Renders); Assert.Null((await State()).Normalization);
        Assert.False(Directory.Exists(Path.Combine(_root, LoudnessNormalizer.FolderName)));
    }

    [Fact]
    public async Task Full_matching_can_reduce_only_when_boost_only_is_explicitly_disabled()
    {
        _normalizer.Input = new(-8, 0, 4, -18, 0, 20);
        var scan = await Scan();
        Assert.Equal(HttpStatusCode.Conflict, (await Create(scan.Analysis!.Id)).StatusCode);
        var response = await Client.PostAsJsonAsync($"/api/tracks/{_id}/loudness/create",
            new { analysisId = scan.Analysis.Id, musicFolder = _root, boostOnly = false });
        response.EnsureSuccessStatusCode();
        var info = (await State()).Normalization!;
        Assert.Equal(-6, info.GainDb); Assert.False(info.BoostOnly);
        Assert.Equal(Source, (await State()).Track.FilePath);
    }

    [Fact]
    public async Task Unexpected_quieter_render_is_discarded_and_does_not_replace_previous_copy()
    {
        var first = await Scan(); (await Create(first.Analysis!.Id)).EnsureSuccessStatusCode();
        var previous = (await State()).Normalization!.OutputPath;
        var scan = await Scan(); _normalizer.OutputLufs = -25;
        var response = await Create(scan.Analysis!.Id);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.Contains("did not become louder", await response.Content.ReadAsStringAsync());
        Assert.Equal(previous, (await State()).Normalization!.OutputPath);
        Assert.Single(Directory.GetFiles(Path.Combine(_root, LoudnessNormalizer.FolderName), "*.wav", SearchOption.AllDirectories));
        Assert.Equal(new byte[] { 1, 2, 3 }, await File.ReadAllBytesAsync(Source));
    }

    [Fact]
    public async Task Reference_matching_validates_snapshot_stores_provenance_and_never_modifies_reference()
    {
        var referenceId = Guid.NewGuid(); var path = Path.Combine(_root, "reference.wav");
        await File.WriteAllBytesAsync(path, [6, 7, 8]);
        _normalizer.BySource[path] = new(-8, -0.1, 3, -18, 0, 20);
        _normalizer.Input = new(-13.59, 0.28, 3.4, -23.6, 0, 20);
        using (var scope = _app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
            db.Tracks.Add(new Track { Id = referenceId, FilePath = path, FileName = "reference.wav", Title = "Reference master" });
            await db.SaveChangesAsync();
        }
        var reference = (await (await Client.PostAsJsonAsync($"/api/tracks/{referenceId}/loudness/scan", new { targetLufs = -14 })).Content.ReadFromJsonAsync<LoudnessState>())!;
        var scan = (await (await Client.PostAsJsonAsync($"/api/tracks/{_id}/loudness/scan", new { targetLufs = -8 })).Content.ReadFromJsonAsync<LoudnessState>())!;
        var body = new { analysisId = scan.Analysis!.Id, musicFolder = _root, boostOnly = true, allowLimiting = true,
            referenceTrackId = referenceId, referenceAnalysisId = reference.Analysis!.Id };
        var wrongReference = await Client.PostAsJsonAsync($"/api/tracks/{_id}/loudness/create", body with { referenceAnalysisId = Guid.NewGuid() });
        Assert.Equal(HttpStatusCode.Conflict, wrongReference.StatusCode);
        Assert.Contains("reference_stale", await wrongReference.Content.ReadAsStringAsync());
        var mismatchedScan = await Scan(); // Target -14 must not silently match reference -8.
        var wrongTarget = await Client.PostAsJsonAsync($"/api/tracks/{_id}/loudness/create", body with { analysisId = mismatchedScan.Analysis!.Id });
        Assert.Equal(HttpStatusCode.Conflict, wrongTarget.StatusCode);
        Assert.Contains("reference_stale", await wrongTarget.Content.ReadAsStringAsync());
        scan = (await (await Client.PostAsJsonAsync($"/api/tracks/{_id}/loudness/scan", new { targetLufs = -8 })).Content.ReadFromJsonAsync<LoudnessState>())!;
        body = body with { analysisId = scan.Analysis!.Id };
        (await Client.PostAsJsonAsync($"/api/tracks/{_id}/loudness/create", body)).EnsureSuccessStatusCode();
        var result = (await State()).Normalization!;
        Assert.Equal(-8, result.TargetLufs); Assert.Equal(5.59, result.GainDb, 5);
        Assert.True(result.Limited); Assert.True(result.BoostOnly); Assert.Equal(referenceId, result.ReferenceTrackId);
        Assert.Equal("Reference master", result.ReferenceTitle); Assert.Equal(reference.Analysis.SourceHash, result.ReferenceSourceHash);
        Assert.Equal(Source, (await State()).Track.FilePath);
        (await Client.PostAsJsonAsync($"/api/tracks/{_id}/loudness/create", body)).EnsureSuccessStatusCode();
        Assert.Equal(1, _normalizer.Renders); // Same options/snapshot retry does not render again.
        var self = await Client.PostAsJsonAsync($"/api/tracks/{referenceId}/loudness/create", body with { analysisId = reference.Analysis.Id });
        Assert.Equal(HttpStatusCode.Conflict, self.StatusCode);
        Assert.Contains("The reference track stays unchanged", await self.Content.ReadAsStringAsync());
        var referenceAfter = (await Client.GetFromJsonAsync<LoudnessState>($"/api/tracks/{referenceId}/loudness"))!;
        Assert.Null(referenceAfter.Normalization); Assert.Equal(path, referenceAfter.Track.FilePath);
        Assert.Equal(new byte[] { 6, 7, 8 }, await File.ReadAllBytesAsync(path));
        // Same-size content modification must invalidate the reference hash too.
        var modified = File.GetLastWriteTimeUtc(path);
        await File.WriteAllBytesAsync(path, [8, 7, 6]); File.SetLastWriteTimeUtc(path, modified);
        var stale = await Client.PostAsJsonAsync($"/api/tracks/{_id}/loudness/create", body);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode); Assert.Contains("reference_stale", await stale.Content.ReadAsStringAsync());
        Assert.Equal(1, _normalizer.Renders);
        File.Delete(path);
        Assert.Equal(HttpStatusCode.Conflict, (await Client.PostAsJsonAsync($"/api/tracks/{_id}/loudness/create", body)).StatusCode);
    }

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
        public LoudnessMeasurement Input = new(-22, -9, 5, -32, 0, 20);
        public Dictionary<string, LoudnessMeasurement> BySource = new();
        public double? OutputLufs;
        public Task<LoudnessMeasurement> MeasureAsync(string source, double target, CancellationToken ct) => Task.FromResult(BySource.GetValueOrDefault(source, Input));
        public async Task<LoudnessRender> RenderAsync(string source, string output, LoudnessMeasurement measured, double target, bool allowLimiting, IReadOnlyDictionary<string, string> metadata, CancellationToken ct)
        {
            Renders++; await File.WriteAllBytesAsync(output, [4, 5, 6], ct);
            if (Fail) throw new TranscodeException("Simulated render failure");
            var plan = LoudnessNormalizer.Plan(measured, target, false, allowLimiting);
            var outputLufs = OutputLufs ?? measured.IntegratedLufs + plan.GainDb;
            return new(new(outputLufs, -1.2, 5, outputLufs - 10, 0, 20), outputLufs - measured.IntegratedLufs, plan.Limited);
        }
    }
    public async Task DisposeAsync() { await _app.DisposeAsync(); await _connection.DisposeAsync(); Directory.Delete(_root, true); }
}
