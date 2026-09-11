using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wisp.Api.Library;
using Wisp.Core.Cleanup;
using Wisp.Core.Cues;
using Wisp.Core.Playlists;
using Wisp.Core.MixPlans;
using Wisp.Core.Tagging;
using Wisp.Core.Tracks;
using Wisp.Core.Wanted;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.FileSystem;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;
using Wisp.Infrastructure.Tagging;

namespace Wisp.Api.Tests;

[Collection("Library file operations")]
public sealed class TrackFileRecoveryTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wisp-recovery-" + Guid.NewGuid().ToString("N"));
    private readonly SqliteConnection _connection = new("Data Source=:memory:");
    private readonly Guid _id = Guid.NewGuid();
    private readonly Validator _validator = new();
    private WebApplication _app = null!;
    private string Original => Path.Combine(_root, "original.aiff");
    private string Replacement => Path.Combine(_root, "replacement.aiff");

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(_root);
        await File.WriteAllBytesAsync(Original, [1, 2, 3]);
        await File.WriteAllBytesAsync(Replacement, [4, 5, 6]);
        await _connection.OpenAsync();
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddDbContext<WispDbContext>(o => o.UseSqlite(_connection));
        builder.Services.AddSingleton<IFileFingerprint, FileFingerprint>();
        builder.Services.AddSingleton<IMetadataReader, MetadataReader>();
        builder.Services.AddSingleton<IAudioFileValidator>(_validator);
        _app = builder.Build();
        _app.MapTrackFiles();
        using var scope = _app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        await db.Database.MigrateAsync();
        db.Tracks.Add(new Track { Id = _id, FilePath = Original, FileName = "original.aiff", FileHash = "old",
            Title = "Curated title", Artist = "Olive", Bpm = 128, MusicalKey = "8A", Notes = "Keep this prep",
            AddedAt = new DateTime(2020, 1, 1), IsUnavailable = true, UnavailableSince = DateTime.UtcNow });
        var cueId = Guid.NewGuid();
        db.CuePoints.Add(new CuePoint { Id = cueId, TrackId = _id, TimeSeconds = 10, Label = "Intro" });
        db.DeviceCues.Add(new DeviceCue { Id = Guid.NewGuid(), TrackId = _id, StartSeconds = 10, SourceCuePointId = cueId });
        db.Playlists.Add(new Playlist { Id = Guid.NewGuid(), Name = "Set", Tracks = [new PlaylistTrack { Id = Guid.NewGuid(), TrackId = _id }] });
        db.MixPlans.Add(new MixPlan { Id = Guid.NewGuid(), Name = "Mix", Tracks = [new MixPlanTrack { Id = Guid.NewGuid(), TrackId = _id, Order = 5, CueInSeconds = 10, TransitionNotes = "Blend here", IsAnchor = true }] });
        db.TrackTags.Add(new TrackTag { Id = Guid.NewGuid(), TrackId = _id, Name = "Warmup" });
        db.WantedTracks.Add(new WantedTrack { Id = Guid.NewGuid(), Artist = "Olive", Title = "Not Alone", MatchedLocalTrackId = _id, MatchedAt = DateTime.UtcNow });
        db.MetadataAuditLogs.Add(new MetadataAuditLog { Id = Guid.NewGuid(), TrackId = _id, Status = CleanupStatus.Applied, FilePathAfter = Original });
        await db.SaveChangesAsync();
        await _app.StartAsync();
    }

    private Task<HttpResponseMessage> Relink(string? path = null, string? expected = null) =>
        _app.GetTestClient().PutAsJsonAsync($"/api/tracks/{_id}/file", new { filePath = path ?? Replacement, expectedFilePath = expected ?? Original });

    [Fact]
    public async Task Relink_preserves_identity_prep_membership_and_source_files()
    {
        (await Relink()).EnsureSuccessStatusCode();
        using var scope = _app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        var track = await db.Tracks.SingleAsync();
        Assert.Equal(_id, track.Id);
        Assert.Equal(Replacement, track.FilePath);
        Assert.NotEqual("old", track.FileHash);
        Assert.Equal(TimeSpan.FromSeconds(280), track.Duration);
        Assert.Equal("Curated title", track.Title);
        Assert.Equal(128, track.Bpm);
        Assert.Equal("8A", track.MusicalKey);
        Assert.Equal("Keep this prep", track.Notes);
        Assert.Equal(2020, track.AddedAt.Year);
        Assert.False(track.IsUnavailable);
        Assert.Null(track.UnavailableSince);
        Assert.Equal(10, (await db.CuePoints.SingleAsync()).TimeSeconds);
        Assert.Equal(10, (await db.DeviceCues.SingleAsync()).StartSeconds);
        Assert.Equal(_id, (await db.PlaylistTracks.SingleAsync()).TrackId);
        var mixTrack = await db.MixPlanTracks.SingleAsync();
        Assert.Equal(10, mixTrack.CueInSeconds);
        Assert.Equal("Blend here", mixTrack.TransitionNotes);
        Assert.True(mixTrack.IsAnchor);
        Assert.Equal("Warmup", (await db.TrackTags.SingleAsync()).Name);
        Assert.Equal(CleanupStatus.Superseded, (await db.MetadataAuditLogs.SingleAsync()).Status);
        Assert.Equal(new byte[] { 1, 2, 3 }, await File.ReadAllBytesAsync(Original));
        Assert.Equal(new byte[] { 4, 5, 6 }, await File.ReadAllBytesAsync(Replacement));
    }

    [Fact]
    public async Task Invalid_audio_leaves_original_link_and_prep_untouched()
    {
        _validator.Fail = true;
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Relink()).StatusCode);
        using var scope = _app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        Assert.Equal(Original, (await db.Tracks.SingleAsync()).FilePath);
        Assert.Equal(CleanupStatus.Applied, (await db.MetadataAuditLogs.SingleAsync()).Status);
        Assert.Equal(1, await db.CuePoints.CountAsync());
    }

    [Theory]
    [InlineData("relative.aiff")]
    [InlineData("missing.aiff")]
    [InlineData("file.txt")]
    public async Task Rejects_bad_or_missing_paths(string name)
    {
        var path = name == "relative.aiff" ? name : Path.Combine(_root, name);
        Assert.Equal(HttpStatusCode.BadRequest, (await Relink(path)).StatusCode);
        Assert.Equal(0, _validator.Calls);
    }

    [Fact]
    public async Task Duplicate_path_is_rejected_case_insensitively()
    {
        using (var scope = _app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
            db.Tracks.Add(new Track { Id = Guid.NewGuid(), FilePath = Replacement.ToUpperInvariant(), FileName = "replacement.aiff", FileHash = "other" });
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Conflict, (await Relink()).StatusCode);
        Assert.Equal(0, _validator.Calls);
    }

    [Fact]
    public async Task Same_path_replacement_is_revalidated_and_stale_dialog_is_rejected()
    {
        (await Relink(Original)).EnsureSuccessStatusCode();
        Assert.Equal(1, _validator.Calls);
        Assert.Equal(HttpStatusCode.Conflict, (await Relink(expected: "old-link.aiff")).StatusCode);
    }

    [Fact]
    public async Task Busy_scan_or_recovery_prevents_both_operations()
    {
        await LibraryFileGate.Instance.WaitAsync();
        try
        {
            Assert.Equal(HttpStatusCode.Conflict, (await Relink()).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await _app.GetTestClient().DeleteAsync($"/api/tracks/{_id}")).StatusCode);
        }
        finally { LibraryFileGate.Instance.Release(); }
    }

    [Fact]
    public async Task Remove_cascades_prep_but_keeps_music_and_clears_wanted_match()
    {
        Assert.Equal(HttpStatusCode.NoContent, (await _app.GetTestClient().DeleteAsync($"/api/tracks/{_id}")).StatusCode);
        using var scope = _app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        Assert.Empty(await db.Tracks.ToListAsync());
        Assert.Empty(await db.CuePoints.ToListAsync());
        Assert.Empty(await db.DeviceCues.ToListAsync());
        Assert.Empty(await db.PlaylistTracks.ToListAsync());
        Assert.Empty(await db.MixPlanTracks.ToListAsync());
        Assert.Empty(await db.TrackTags.ToListAsync());
        Assert.Single(await db.MixPlans.ToListAsync());
        Assert.Single(await db.Playlists.ToListAsync());
        var wanted = await db.WantedTracks.SingleAsync();
        Assert.Null(wanted.MatchedLocalTrackId);
        Assert.Null(wanted.MatchedAt);
        Assert.Equal(CleanupStatus.Superseded, (await db.MetadataAuditLogs.SingleAsync()).Status);
        Assert.True(File.Exists(Original));
        Assert.True(File.Exists(Replacement));
        Assert.Equal(HttpStatusCode.NotFound, (await _app.GetTestClient().DeleteAsync($"/api/tracks/{_id}")).StatusCode);
    }

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        await _connection.DisposeAsync();
        Directory.Delete(_root, recursive: true);
    }

    private sealed class Validator : IAudioFileValidator
    {
        public bool Fail;
        public int Calls;
        public Task<TimeSpan> ValidateAsync(string path, CancellationToken ct)
        {
            Calls++;
            if (Fail) throw new TranscodeException("This test file is corrupt.");
            return Task.FromResult(TimeSpan.FromSeconds(280));
        }
    }
}
