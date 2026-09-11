using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Infrastructure.Tests;

public sealed class TrackFileDateBackfillTests
{
    [Fact]
    public async Task Backfill_populates_existing_files_preserving_import_dates_and_known_dates()
    {
        var root = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), "wisp-backfill-" + Guid.NewGuid().ToString("N"))).FullName;
        try
        {
            var path = Path.Combine(root, "track.mp3");
            await File.WriteAllBytesAsync(path, [0, 1, 2]);
            await using var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var services = new ServiceCollection().AddLogging().AddDbContext<WispDbContext>(o => o.UseSqlite(connection));
            await using var provider = services.BuildServiceProvider();
            var added = DateTime.UtcNow.AddYears(-1);
            var knownDate = DateTime.UtcNow.AddDays(-1);
            await using (var scope = provider.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
                await db.Database.MigrateAsync();
                db.Tracks.AddRange(
                    new Track { Id = Guid.NewGuid(), FilePath = path, FileName = "track.mp3", FileHash = "a", AddedAt = added, Notes = "Keep prep" },
                    new Track { Id = Guid.NewGuid(), FilePath = Path.Combine(root, "offline.mp3"), FileName = "offline.mp3", FileHash = "b", AddedAt = added },
                    new Track { Id = Guid.NewGuid(), FilePath = Path.Combine(root, "known.mp3"), FileName = "known.mp3", FileHash = "c", AddedAt = added, FileModifiedAt = knownDate });
                await db.SaveChangesAsync();
            }
            using var worker = new TrackFileDateBackfill(provider.GetRequiredService<IServiceScopeFactory>(), provider.GetRequiredService<ILogger<TrackFileDateBackfill>>());
            await worker.StartAsync(CancellationToken.None);
            await worker.ExecuteTask!.WaitAsync(TimeSpan.FromSeconds(10));
            await using var verify = provider.CreateAsyncScope();
            var tracks = await verify.ServiceProvider.GetRequiredService<WispDbContext>().Tracks.ToListAsync();
            Assert.Equal(File.GetLastWriteTimeUtc(path), tracks.Single(t => t.FileName == "track.mp3").FileModifiedAt);
            Assert.Equal("Keep prep", tracks.Single(t => t.FileName == "track.mp3").Notes);
            Assert.Null(tracks.Single(t => t.FileName == "offline.mp3").FileModifiedAt);
            Assert.Equal(knownDate, tracks.Single(t => t.FileName == "known.mp3").FileModifiedAt);
            Assert.All(tracks, t => Assert.Equal(added, t.AddedAt));
        }
        finally { Directory.Delete(root, true); }
    }
}
