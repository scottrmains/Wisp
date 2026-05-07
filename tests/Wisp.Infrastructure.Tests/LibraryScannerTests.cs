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

    private async Task<ScanJob> RunScan(string folder)
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
            new MetadataReader(),
            new ScanProgressBus(),
            NullLogger<LibraryScanner>.Instance);

        await scanner.RunAsync(new ScanRequest(job.Id, folder), CancellationToken.None);

        await using var verify = NewContext();
        return await verify.ScanJobs.FirstAsync(s => s.Id == job.Id);
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
    public async Task Removed_file_is_deleted_from_library()
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
        Assert.Empty(db.Tracks);
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
}
