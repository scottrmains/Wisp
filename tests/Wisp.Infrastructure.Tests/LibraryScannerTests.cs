using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.FileSystem;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;
using Wisp.Infrastructure.Tagging;
using Xunit;

namespace Wisp.Infrastructure.Tests;

public class LibraryScannerTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "wisp-scan-" + Guid.NewGuid().ToString("N"));
    private readonly string _dbPath;

    public LibraryScannerTests()
    {
        Directory.CreateDirectory(_dir);
        _dbPath = Path.Combine(_dir, "scan-test.db");
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { /* best effort */ }
    }

    private WispDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<WispDbContext>()
            .UseSqlite($"Data Source={_dbPath}")
            .Options;
        var ctx = new WispDbContext(options);
        ctx.Database.Migrate();
        return ctx;
    }

    private async Task<ScanJob> RunScan(string folder, IMetadataReader? reader = null)
    {
        await using var db = NewContext();
        var job = new ScanJob
        {
            Id = Guid.NewGuid(),
            FolderPath = folder,
            Status = ScanStatus.Pending,
            StartedAt = DateTime.UtcNow,
        };
        db.ScanJobs.Add(job);
        await db.SaveChangesAsync();

        var scanner = new LibraryScanner(
            db,
            new FileScanner(),
            new FileFingerprint(),
            reader ?? new MetadataReader(),
            new ScanProgressBus(),
            NullLogger<LibraryScanner>.Instance);

        await scanner.RunAsync(new ScanRequest(job.Id, folder), CancellationToken.None);

        await using var verify = NewContext();
        return await verify.ScanJobs.FirstAsync(s => s.Id == job.Id);
    }

    [Fact]
    public async Task Rescan_updates_file_date_without_changing_import_date_or_identity()
    {
        var folder = Directory.CreateDirectory(Path.Combine(_dir, "file-dates")).FullName;
        var path = Path.Combine(folder, "Artist - Track.mp3");
        await File.WriteAllBytesAsync(path, [0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0]);
        await RunScan(folder);
        await using var originalDb = NewContext();
        var original = Assert.Single(originalDb.Tracks);
        Assert.Equal(File.GetLastWriteTimeUtc(path), original.FileModifiedAt);
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddDays(-10));
        await RunScan(folder);
        await using var updatedDb = NewContext();
        var updated = Assert.Single(updatedDb.Tracks);
        Assert.Equal(original.Id, updated.Id);
        Assert.Equal(original.AddedAt, updated.AddedAt);
        Assert.Equal(File.GetLastWriteTimeUtc(path), updated.FileModifiedAt);
        Assert.NotEqual(original.FileModifiedAt, updated.FileModifiedAt);
    }

    [Fact]
    public async Task Empty_folder_completes_cleanly()
    {
        var folder = Path.Combine(_dir, "empty");
        Directory.CreateDirectory(folder);

        var result = await RunScan(folder);

        Assert.Equal(ScanStatus.Completed, result.Status);
        Assert.Equal(0, result.TotalFiles);
        Assert.Equal(0, result.AddedTracks);
    }

    [Fact]
    public async Task Adds_track_when_audio_file_present_using_filename_fallback()
    {
        var folder = Path.Combine(_dir, "with-audio");
        Directory.CreateDirectory(folder);
        // Bogus mp3 bytes — TagLib will fail to parse, scanner falls back to filename.
        await File.WriteAllBytesAsync(
            Path.Combine(folder, "Kim English - Nite Life (Bump Classic Mix) 1994.mp3"),
            new byte[] { 0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 });

        var result = await RunScan(folder);

        Assert.Equal(ScanStatus.Completed, result.Status);
        Assert.Equal(1, result.TotalFiles);
        Assert.Equal(1, result.AddedTracks);

        await using var db = NewContext();
        var track = Assert.Single(db.Tracks);
        Assert.Equal("Kim English", track.Artist);
        Assert.Equal("Nite Life", track.Title);
        Assert.Equal("Bump Classic Mix", track.Version);
        Assert.Equal(1994, track.ReleaseYear);
    }

    [Fact]
    public async Task Second_scan_is_idempotent()
    {
        var folder = Path.Combine(_dir, "idempotent");
        Directory.CreateDirectory(folder);
        await File.WriteAllBytesAsync(
            Path.Combine(folder, "Disclosure - F For You.mp3"),
            new byte[] { 0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 });

        var first = await RunScan(folder);
        var second = await RunScan(folder);

        Assert.Equal(1, first.AddedTracks);
        Assert.Equal(0, second.AddedTracks);
        Assert.Equal(0, second.UpdatedTracks);
        Assert.Equal(0, second.RemovedTracks);

        await using var db = NewContext();
        Assert.Single(db.Tracks);
    }

    [Fact]
    public async Task Removed_file_is_retained_as_unavailable_so_prep_is_not_lost()
    {
        var folder = Path.Combine(_dir, "removed");
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "MK - Burning.mp3");
        await File.WriteAllBytesAsync(path, new byte[] { 0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 });

        await RunScan(folder);
        File.Delete(path);
        var second = await RunScan(folder);

        Assert.Equal(1, second.RemovedTracks);

        await using var db = NewContext();
        var track = Assert.Single(db.Tracks);
        Assert.True(track.IsUnavailable);
        Assert.NotNull(track.UnavailableSince);
    }

    [Fact]
    public async Task Reappearing_file_restores_its_existing_track_identity()
    {
        var folder = Path.Combine(_dir, "reappears");
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "MK - Burning.mp3");
        await File.WriteAllBytesAsync(path, new byte[] { 0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 });

        await RunScan(folder);
        await using var firstDb = NewContext();
        var originalId = Assert.Single(firstDb.Tracks).Id;

        File.Delete(path);
        await RunScan(folder);
        await File.WriteAllBytesAsync(path, new byte[] { 0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 });
        await RunScan(folder);

        await using var verify = NewContext();
        var track = Assert.Single(verify.Tracks);
        Assert.Equal(originalId, track.Id);
        Assert.False(track.IsUnavailable);
        Assert.Null(track.UnavailableSince);
    }

    [Fact]
    public async Task Skips_unreadable_file_without_failing_scan()
    {
        var folder = Path.Combine(_dir, "permission");
        Directory.CreateDirectory(folder);
        // Write a file then take an exclusive lock so the scanner can't open it.
        var locked = Path.Combine(folder, "locked.mp3");
        await File.WriteAllBytesAsync(locked, new byte[] { 0, 0, 0, 0 });

        using var holder = new FileStream(locked, FileMode.Open, FileAccess.Read, FileShare.None);

        var result = await RunScan(folder);

        Assert.Equal(ScanStatus.Completed, result.Status);
        Assert.Equal(1, result.TotalFiles);
        Assert.Equal(1, result.SkippedFiles);
        Assert.Equal(0, result.AddedTracks);
    }

    private sealed class TestMetadata : IMetadataReader
    {
        public TrackMetadata Read(string path) => new() { Artist = "Artist", Title = "Track", Duration = TimeSpan.FromSeconds(300), MusicalKey = "8A", Bpm = 123 };
    }

    [Fact]
    public async Task Renamed_and_retagged_file_preserves_prep_and_does_not_import_duplicate()
    {
        var folder = Directory.CreateDirectory(Path.Combine(_dir, "retagged")).FullName;
        var oldPath = Path.Combine(folder, "Artist - Track.mp3");
        var newPath = Path.Combine(folder, "Artist - Track - 8A - 123.mp3");
        await File.WriteAllBytesAsync(oldPath, [1, 2, 3]);
        await RunScan(folder, new TestMetadata());
        Guid id;
        await using (var db = NewContext())
        {
            var track = await db.Tracks.SingleAsync(); id = track.Id;
            track.Notes = "Do not lose this";
            db.CuePoints.Add(new() { Id = Guid.NewGuid(), TrackId = id, TimeSeconds = 35 });
            db.DeviceCues.Add(new() { Id = Guid.NewGuid(), TrackId = id, StartSeconds = 35 });
            db.Playlists.Add(new() { Id = Guid.NewGuid(), Name = "Set", Tracks = [new() { Id = Guid.NewGuid(), TrackId = id, AddedAt = new DateTime(2020, 1, 1) }] });
            db.MixPlans.Add(new() { Id = Guid.NewGuid(), Name = "Plan", Tracks = [new() { Id = Guid.NewGuid(), TrackId = id, Order = 3 }] });
            db.MetadataAuditLogs.Add(new() { Id = Guid.NewGuid(), TrackId = id, Status = Wisp.Core.Cleanup.CleanupStatus.Applied });
            await db.SaveChangesAsync();
        }
        File.Move(oldPath, newPath); await File.WriteAllBytesAsync(newPath, [4, 5, 6]);
        var result = await RunScan(folder, new TestMetadata());
        Assert.Equal(ScanStatus.Completed, result.Status);
        Assert.Equal(0, result.AddedTracks); Assert.Equal(1, result.UpdatedTracks); Assert.Equal(0, result.RemovedTracks);
        await using var verify = NewContext();
        var recovered = Assert.Single(await verify.Tracks.ToListAsync());
        Assert.Equal(id, recovered.Id); Assert.Equal(newPath, recovered.FilePath); Assert.Equal("Do not lose this", recovered.Notes);
        Assert.False(recovered.IsUnavailable);
        Assert.Equal(35, (await verify.CuePoints.SingleAsync()).TimeSeconds);
        Assert.Equal(35, (await verify.DeviceCues.SingleAsync()).StartSeconds);
        Assert.Equal(2020, (await verify.PlaylistTracks.SingleAsync()).AddedAt.Year);
        Assert.Equal(3, (await verify.MixPlanTracks.SingleAsync()).Order);
        Assert.Equal(Wisp.Core.Cleanup.CleanupStatus.Superseded, (await verify.MetadataAuditLogs.SingleAsync()).Status);
        var repeated = await RunScan(folder, new TestMetadata());
        Assert.Equal(0, repeated.AddedTracks); Assert.Equal(0, repeated.UpdatedTracks);
    }

    [Fact]
    public async Task Ambiguous_renames_are_skipped_without_creating_duplicate_rows()
    {
        var folder = Directory.CreateDirectory(Path.Combine(_dir, "ambiguous")).FullName;
        var original = Path.Combine(folder, "Artist - Track.mp3");
        await File.WriteAllBytesAsync(original, [1, 2, 3]);
        await RunScan(folder);
        File.Move(original, Path.Combine(folder, "one.mp3"));
        File.Copy(Path.Combine(folder, "one.mp3"), Path.Combine(folder, "two.mp3"));
        var scan = await RunScan(folder);
        Assert.Equal(0, scan.AddedTracks); Assert.Equal(2, scan.SkippedFiles);
        await using var db = NewContext();
        Assert.True((await db.Tracks.SingleAsync()).IsUnavailable);
    }
}
