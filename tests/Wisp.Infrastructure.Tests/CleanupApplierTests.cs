using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Wisp.Core.Cleanup;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Cleanup;
using Wisp.Infrastructure.Persistence;
using Xunit;
using TagFile = TagLib.File;

namespace Wisp.Infrastructure.Tests;

public class CleanupApplierTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "wisp-cleanup-" + Guid.NewGuid().ToString("N"));
    private readonly string _dbPath;
    private readonly string _fixtureMp3;

    public CleanupApplierTests()
    {
        Directory.CreateDirectory(_dir);
        _dbPath = Path.Combine(_dir, "cleanup-test.db");

        // Stage a writable copy of a real Pioneer demo MP3 so TagLib can actually read/write it.
        var sourceMp3 = @"C:\Users\scott\Music\PioneerDJ\Demo Tracks\Demo Track 1.mp3";
        if (!File.Exists(sourceMp3))
        {
            // Skip the integration tests when the demo file isn't available; throw a SkipException-equivalent.
            // xUnit doesn't have a clean Skip primitive without an extension, so we just leave _fixtureMp3 null.
            _fixtureMp3 = null!;
            return;
        }
        _fixtureMp3 = Path.Combine(_dir, "fixture.mp3");
        File.Copy(sourceMp3, _fixtureMp3);
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { /* best effort */ }
    }

    private WispDbContext NewContext()
    {
        var ctx = new WispDbContext(new DbContextOptionsBuilder<WispDbContext>()
            .UseSqlite($"Data Source={_dbPath}").Options);
        ctx.Database.Migrate();
        return ctx;
    }

    private async Task<Track> SeedTrack(string fileName, string? artist, string? title, string? version = null)
    {
        // Make a per-test copy so each test starts with a fresh file.
        var dest = Path.Combine(_dir, fileName);
        File.Copy(_fixtureMp3, dest, overwrite: true);

        await using var db = NewContext();
        var t = new Track
        {
            Id = Guid.NewGuid(),
            FilePath = dest,
            FileName = fileName,
            FileHash = "h" + Guid.NewGuid().ToString("N")[..8],
            Artist = artist,
            Title = title,
            Version = version,
            AddedAt = DateTime.UtcNow,
        };
        db.Tracks.Add(t);
        await db.SaveChangesAsync();
        return t;
    }

    private CleanupApplier MakeApplier(WispDbContext db) =>
        new(db, new CleanupSuggestionService(), NullLogger<CleanupApplier>.Instance);

    [Fact]
    public async Task Apply_renames_file_and_writes_tags_and_audits()
    {
        if (_fixtureMp3 is null) return; // skip when fixture missing

        var t = await SeedTrack("dirty name 320kbps.mp3", "kim english", "Nite Life [FREE DL]");

        await using var db = NewContext();
        var (audit, _) = await MakeApplier(db).ApplyAsync(t.Id, CancellationToken.None);

        Assert.Equal(CleanupStatus.Applied, audit.Status);
        Assert.False(File.Exists(t.FilePath), "old filename should no longer exist on disk");
        Assert.True(File.Exists(audit.FilePathAfter), "new filename should exist on disk");
        Assert.EndsWith("Kim English - Nite Life.mp3", audit.FilePathAfter);

        // Tags should reflect cleaned values when re-read via TagLib.
        using var tagged = TagFile.Create(audit.FilePathAfter);
        Assert.Equal("Kim English", tagged.Tag.JoinedPerformers);
        Assert.Equal("Nite Life", tagged.Tag.Title);

        // Track row was updated.
        await using var verify = NewContext();
        var saved = await verify.Tracks.FindAsync(t.Id);
        Assert.Equal("Kim English", saved!.Artist);
        Assert.Equal("Nite Life", saved.Title);
    }

    [Fact]
    public async Task Apply_then_undo_restores_original_state()
    {
        if (_fixtureMp3 is null) return;

        var t = await SeedTrack("dirty name (copy).mp3", "kim english", "Nite Life [FREE DL]");
        var originalPath = t.FilePath;
        var originalArtist = t.Artist;
        var originalTitle = t.Title;

        await using var db = NewContext();
        var applier = MakeApplier(db);
        var (audit, _) = await applier.ApplyAsync(t.Id, CancellationToken.None);
        Assert.NotEqual(originalPath, audit.FilePathAfter);

        await using var db2 = NewContext();
        var undone = await MakeApplier(db2).UndoAsync(audit.Id, CancellationToken.None);

        Assert.Equal(CleanupStatus.RolledBack, undone.Status);
        Assert.True(File.Exists(originalPath), "original filename should be back on disk");
        Assert.False(File.Exists(audit.FilePathAfter), "cleaned filename should be gone");

        await using var verify = NewContext();
        var restored = await verify.Tracks.FindAsync(t.Id);
        Assert.Equal(originalArtist, restored!.Artist);
        Assert.Equal(originalTitle, restored.Title);
        Assert.Equal(originalPath, restored.FilePath);
    }

    [Fact]
    public async Task Apply_throws_when_nothing_to_clean()
    {
        if (_fixtureMp3 is null) return;

        var t = await SeedTrack("MK - Burning.mp3", "MK", "Burning");

        await using var db = NewContext();
        var applier = MakeApplier(db);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => applier.ApplyAsync(t.Id, CancellationToken.None));
    }
}
