using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.FileSystem;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;
using Wisp.Infrastructure.Tagging;

namespace Wisp.Infrastructure.Tests;

public sealed class PortableTrackIdentityTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "wisp-portable-" + Guid.NewGuid().ToString("N"));
    private readonly string ffmpeg = Environment.GetEnvironmentVariable("WISP_TEST_FFMPEG")
        ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../tools/ffmpeg/ffmpeg.exe"));
    private PortableTrackIdentity Identity => new(Audio, new FileFingerprint());
    private AudioContentFingerprint Audio => new(new Mp3Transcoder(NullLogger<Mp3Transcoder>.Instance, () => ffmpeg));

    public PortableTrackIdentityTests() => Directory.CreateDirectory(root);
    public void Dispose() { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); Directory.Delete(root, true); }

    private async Task<string> Sample(string extension, int frequency = 440, string name = "original")
    {
        Assert.True(File.Exists(ffmpeg), "Set WISP_TEST_FFMPEG to run portable identity integration tests.");
        var path = Path.Combine(root, name + extension);
        using var process = new Process { StartInfo = new(ffmpeg) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true } };
        foreach (var arg in new[] { "-nostdin", "-v", "error", "-f", "lavfi", "-i", $"sine=frequency={frequency}:duration=1", "-ar", "48000", "-ac", "2",
            "-metadata", "artist=Test Artist", "-metadata", "title=Test Track", "-metadata", "comment=Keep this comment", path })
            process.StartInfo.ArgumentList.Add(arg);
        process.Start(); var stderr = process.StandardError.ReadToEndAsync(); await process.WaitForExitAsync();
        Assert.True(process.ExitCode == 0, await stderr);
        return path;
    }

    private Track Track(string path) => new() { Id = Guid.NewGuid(), FilePath = path, FileName = Path.GetFileName(path),
        Title = "Curated", Notes = "Keep my cues", AddedAt = new DateTime(2020, 1, 1), Duration = new MetadataReader().Read(path).Duration };

    [Theory]
    [InlineData(".mp3", "embedded")]
    [InlineData(".flac", "embedded")]
    [InlineData(".m4a", "embedded")]
    [InlineData(".aiff", "embedded")]
    [InlineData(".aif", "embedded")]
    [InlineData(".wav", "sidecar")]
    [InlineData(".ogg", "sidecar")]
    [InlineData(".opus", "sidecar")]
    public async Task Identity_roundtrips_without_changing_audio_or_standard_tags(string extension, string storage)
    {
        var path = await Sample(extension); var track = Track(path);
        var before = await Audio.ComputeAsync(path, default);
        var metadata = new MetadataReader().Read(path);
        await Identity.EnsureAsync(track, default);
        Assert.Equal(storage, track.IdentityStorage);
        Assert.Equal(before, await Audio.ComputeAsync(path, default));
        Assert.Equal(metadata, new MetadataReader().Read(path));
        Assert.Equal(track.Id, (await Identity.ReadAsync(path, default)).TrackId);
        var stampedBytes = await new FileFingerprint().ComputeAsync(path);
        await Identity.EnsureAsync(track, default);
        Assert.Equal(stampedBytes, await new FileFingerprint().ComputeAsync(path));
        Assert.Equal("Curated", track.Title); Assert.Equal("Keep my cues", track.Notes);
        using (var tags = TagLib.File.Create(path))
        {
            tags.Tag.Title = "After external analysis"; tags.Tag.InitialKey = "9A"; tags.Tag.BeatsPerMinute = 125; tags.Save();
        }
        Assert.Equal(before, await Audio.ComputeAsync(path, default));
        Assert.Equal(track.Id, (await Identity.ReadAsync(path, default)).TrackId);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Arbitrary_move_and_retag_recover_same_track_even_if_id_is_stripped(bool stripId)
    {
        var path = await Sample(".mp3"); var track = Track(path);
        await Identity.EnsureAsync(track, default);
        using (var tag = TagLib.File.Create(path))
        {
            tag.Tag.Title = "Completely different external title"; tag.Tag.InitialKey = "8A"; tag.Tag.BeatsPerMinute = 128;
            if (stripId && tag.GetTag(TagLib.TagTypes.Id3v2) is TagLib.Id3v2.Tag id3)
                foreach (var frame in id3.GetFrames<TagLib.Id3v2.UserTextInformationFrame>().Where(f => f.Description == PortableTrackIdentity.Field).ToArray()) id3.RemoveFrame(frame);
            tag.Save();
        }
        var folder = Directory.CreateDirectory(Path.Combine(root, "moved")).FullName;
        var renamed = Path.Combine(folder, "arbitrary-name.mp3"); File.Move(path, renamed);
        using var db = Context(); db.Database.Migrate(); db.Tracks.Add(track); await db.SaveChangesAsync();
        db.CuePoints.Add(new() { Id = Guid.NewGuid(), TrackId = track.Id, TimeSeconds = .5 }); await db.SaveChangesAsync();
        var service = new TrackRenameRecoveryService(db, new FileFingerprint(), new MetadataReader(), NullLogger<TrackRenameRecoveryService>.Instance, Identity);
        var match = Assert.Single((await service.PlanAsync([track], [track], [renamed], default)).Matches);
        Assert.Equal(stripId ? "verified-audio-content" : "verified-portable-id", match.Reason);
        Assert.True(await service.ApplyAsync(match, default));
        Assert.Equal(renamed, (await db.Tracks.SingleAsync()).FilePath);
        Assert.Equal(.5, (await db.CuePoints.SingleAsync()).TimeSeconds);
        Assert.Equal("Curated", track.Title); Assert.Equal("8A", track.MusicalKey);
        await Identity.EnsureAsync(track, default); // missing marker is restored after content verification
        Assert.Equal(track.Id, (await Identity.ReadAsync(renamed, default)).TrackId);
    }

    [Fact]
    public async Task Copied_id_on_different_audio_and_two_identical_candidates_are_not_relinked()
    {
        var first = await Sample(".mp3"); var track = Track(first); await Identity.EnsureAsync(track, default);
        var other = await Sample(".mp3", 880, "other");
        using (var tag = TagLib.File.Create(other))
        {
            var id3 = (TagLib.Id3v2.Tag)tag.GetTag(TagLib.TagTypes.Id3v2, true);
            TagLib.Id3v2.UserTextInformationFrame.Get(id3, PortableTrackIdentity.Field, true).Text = [track.Id.ToString("D")]; tag.Save();
        }
        using var db = Context(); db.Database.Migrate(); db.Tracks.Add(track); await db.SaveChangesAsync();
        var service = new TrackRenameRecoveryService(db, new FileFingerprint(), new MetadataReader(), NullLogger<TrackRenameRecoveryService>.Instance, Identity);
        var copy1 = Path.Combine(root, "one.mp3"); var copy2 = Path.Combine(root, "two.mp3");
        File.Copy(first, copy1); File.Move(first, copy2);
        var conflict = await service.PlanAsync([track], [track], [other], default);
        Assert.Empty(conflict.Matches); Assert.Contains(other, conflict.AmbiguousPaths);
        var ambiguous = await service.PlanAsync([track], [track], [copy1, copy2], default);
        Assert.Empty(ambiguous.Matches); Assert.Equal(2, ambiguous.AmbiguousPaths.Count);
    }

    [Fact]
    public async Task Sidecar_audio_recovers_after_rename_even_when_sidecar_stays_behind()
    {
        var path = await Sample(".wav"); var track = Track(path); await Identity.EnsureAsync(track, default);
        var renamed = Path.Combine(root, "new.wav"); File.Move(path, renamed);
        var portable = await Identity.ReadAsync(renamed, default);
        Assert.Null(portable.TrackId);
        var plan = TrackRenameRecovery.Plan([track], [new(renamed, "new", new MetadataReader().Read(renamed), portable.TrackId, portable.AudioHash)]);
        Assert.Single(plan.Matches);
    }

    [Fact]
    public async Task Scanner_initialises_existing_rows_and_uses_ids_without_duplicating_memberships()
    {
        var path = await Sample(".flac"); var track = Track(path);
        track.FileHash = await new FileFingerprint().ComputeAsync(path);
        using var db = Context(); db.Database.Migrate(); db.Tracks.Add(track);
        db.Playlists.Add(new() { Id = Guid.NewGuid(), Name = "Set", Tracks = [new() { Id = Guid.NewGuid(), TrackId = track.Id }] });
        await db.SaveChangesAsync();
        async Task<ScanJob> Scan()
        {
            var job = new ScanJob { Id = Guid.NewGuid(), FolderPath = root }; db.ScanJobs.Add(job); await db.SaveChangesAsync();
            await new LibraryScanner(db, new FileScanner(), new FileFingerprint(), new MetadataReader(), new ScanProgressBus(), NullLogger<LibraryScanner>.Instance, Identity)
                .RunAsync(new(job.Id, root), default);
            Assert.Equal(ScanStatus.Completed, job.Status); return job;
        }
        await Scan(); Assert.NotNull(track.AudioContentHash); Assert.Equal("embedded", track.IdentityStorage);
        var renamed = Path.Combine(root, "arbitrary.flac"); File.Move(path, renamed);
        var result = await Scan(); Assert.Equal(0, result.AddedTracks);
        Assert.Equal(track.Id, (await db.Tracks.SingleAsync()).Id); Assert.Equal(renamed, track.FilePath);
        Assert.Equal(track.Id, (await db.PlaylistTracks.SingleAsync()).TrackId);
        File.Copy(renamed, Path.Combine(root, "duplicate.flac"));
        var copied = await Scan(); Assert.Equal(0, copied.AddedTracks); Assert.Equal(1, copied.SkippedFiles);
    }

    private WispDbContext Context() => new(new DbContextOptionsBuilder<WispDbContext>().UseSqlite($"Data Source={Path.Combine(root, "isolated.db")}").Options);

    [Fact]
    public async Task Readonly_source_uses_sidecar_and_preserves_bytes()
    {
        var path = await Sample(".mp3"); var track = Track(path);
        track.Duration = TimeSpan.Zero; // Backfill duration for a legacy row with incomplete metadata.
        var before = await new FileFingerprint().ComputeAsync(path);
        File.SetAttributes(path, FileAttributes.ReadOnly);
        try
        {
            await Identity.EnsureAsync(track, default);
            Assert.Equal("sidecar", track.IdentityStorage);
            Assert.True(track.Duration > TimeSpan.Zero);
            Assert.Equal(before, await new FileFingerprint().ComputeAsync(path));
        }
        finally { File.SetAttributes(path, FileAttributes.Normal); }
    }

    [Fact]
    public async Task Foreign_and_stale_sidecar_ids_cannot_override_audio_identity()
    {
        var path = await Sample(".wav"); var track = Track(path); await Identity.EnsureAsync(track, default);
        await File.WriteAllTextAsync(path + PortableTrackIdentity.SidecarSuffix, System.Text.Json.JsonSerializer.Serialize(
            new { Version = 1, TrackId = Guid.NewGuid(), AudioHash = track.AudioContentHash }));
        await Assert.ThrowsAsync<IOException>(() => Identity.EnsureAsync(track, default));
        await File.WriteAllTextAsync(path + PortableTrackIdentity.SidecarSuffix, "{broken json");
        Assert.True((await Identity.ReadAsync(path, default)).Conflict);
    }

    [Fact]
    public async Task Existing_third_party_custom_tags_survive_identity_writes()
    {
        var path = await Sample(".mp3");
        using (var file = TagLib.File.Create(path))
        {
            var id3 = (TagLib.Id3v2.Tag)file.GetTag(TagLib.TagTypes.Id3v2, true);
            TagLib.Id3v2.UserTextInformationFrame.Get(id3, "ExternalCueData", true).Text = ["0.25;0.75;opaque-payload"];
            file.Tag.Comment = "Keep mix notes"; file.Save();
        }
        await Identity.EnsureAsync(Track(path), default);
        using var verify = TagLib.File.Create(path);
        Assert.Equal("Keep mix notes", verify.Tag.Comment);
        Assert.Equal("0.25;0.75;opaque-payload", TagLib.Id3v2.UserTextInformationFrame.Get(
            (TagLib.Id3v2.Tag)verify.GetTag(TagLib.TagTypes.Id3v2), "ExternalCueData", false).Text.Single());
    }
}
