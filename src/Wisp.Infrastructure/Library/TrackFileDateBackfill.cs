using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Infrastructure.Library;

/// Populate the new date column for an existing library without re-importing
/// tracks or rewriting their tags, cue points, AddedAt or playlist membership.
public sealed class TrackFileDateBackfill(IServiceScopeFactory scopes, ILogger<TrackFileDateBackfill> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
            var tracks = await db.Tracks.AsNoTracking().Where(t => t.FileModifiedAt == null)
                .Select(t => new { t.Id, t.FilePath }).ToListAsync(stoppingToken);
            foreach (var track in tracks)
            {
                stoppingToken.ThrowIfCancellationRequested();
                try
                {
                    var file = new FileInfo(track.FilePath);
                    if (!file.Exists) continue;
                    // Only fill a still-unknown value, so a concurrent scan wins.
                    await db.Tracks.Where(t => t.Id == track.Id && t.FileModifiedAt == null)
                        .ExecuteUpdateAsync(u => u.SetProperty(t => t.FileModifiedAt, file.LastWriteTimeUtc), stoppingToken);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
                {
                    log.LogDebug(ex, "Could not read file date for track {TrackId}", track.Id);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        catch (Exception ex) { log.LogWarning(ex, "File-date backfill will retry on the next launch"); }
    }
}
