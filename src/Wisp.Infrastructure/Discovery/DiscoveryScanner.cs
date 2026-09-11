using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Wisp.Core.Discovery;
using Wisp.Infrastructure.ExternalCatalog.YouTube;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Infrastructure.Discovery;

public class DiscoveryScanner(
    WispDbContext db,
    YouTubeCatalogClient youTube,
    DiscoveryScanProgressBus progress,
    ILogger<DiscoveryScanner> log)
{
    public async Task RunAsync(DiscoveryScanRequest request, CancellationToken ct)
    {
        var source = await db.DiscoverySources.FirstOrDefaultAsync(s => s.Id == request.SourceId, ct);
        if (source is null)
        {
            Emit(request.SourceId, DiscoveryScanStatus.Failed, 0, 0, 0, "This source no longer exists.");
            progress.Complete(request.SourceId);
            return;
        }

        Emit(source.Id, DiscoveryScanStatus.Running, 0, 0, 0, null);

        try
        {
            var existing = await db.DiscoveredTracks
                .Where(t => t.DiscoverySourceId == source.Id)
                .ToListAsync(ct);
            var byVideoId = existing.ToDictionary(t => t.SourceVideoId, StringComparer.Ordinal);

            var uploads = source.SourceType == DiscoverySourceType.YouTubePlaylist
                ? (await youTube.GetPlaylistAsync(source.ExternalSourceId, ct)).Items
                : await youTube.PageThroughPlaylistItemsAsync(
                    source.UploadsPlaylistId ?? throw new InvalidOperationException("Channel has no uploads playlist id."),
                    maxItems: 5000, ct);

            var channelTitle = source.Name;
            var newItems = 0;
            var confidentParses = 0;
            var updatedDates = 0;
            var now = DateTime.UtcNow;

            foreach (var u in uploads)
            {
                ct.ThrowIfCancellationRequested();
                if (byVideoId.TryGetValue(u.VideoId, out var stored))
                {
                    // Backfill old imports without resetting statuses, user corrections or matches.
                    if (u.PublishedAt is { } published && stored.PublishedAt != published.UtcDateTime)
                    {
                        stored.PublishedAt = published.UtcDateTime;
                        updatedDates++;
                    }
                    continue;
                }

                var parsed = YouTubeTitleParser.Parse(u.Title, channelTitle);
                if (!parsed.IsLowConfidence) confidentParses++;

                var track = new DiscoveredTrack
                {
                    Id = Guid.NewGuid(),
                    DiscoverySourceId = source.Id,
                    SourceVideoId = u.VideoId,
                    SourceUrl = u.Url,
                    RawTitle = u.Title,
                    Description = u.Description,
                    ThumbnailUrl = u.ThumbnailUrl,
                    ParsedArtist = parsed.Artist,
                    ParsedTitle = parsed.Title,
                    MixVersion = parsed.Version,
                    ReleaseYear = parsed.Year,
                    Status = DiscoveryStatus.New,
                    ImportedAt = now,
                    PublishedAt = u.PublishedAt?.UtcDateTime,
                };
                db.DiscoveredTracks.Add(track);
                byVideoId.Add(u.VideoId, track);
                newItems++;
            }

            source.LastScannedAt = now;
            source.ImportedCount = existing.Count + newItems;
            await db.SaveChangesAsync(ct);

            Emit(source.Id, DiscoveryScanStatus.Completed, source.ImportedCount, newItems, confidentParses, null,
                updatedDates, uploads.Select(u => u.VideoId).Distinct(StringComparer.Ordinal).Count());
            log.LogInformation("Discovery scan {Source} complete: {New} new / {Total} total / {Confident} parsed cleanly",
                source.Name, newItems, source.ImportedCount, confidentParses);
        }
        catch (YouTubeQuotaExceededException ex)
        {
            log.LogWarning("Discovery scan {Source} hit quota: {Msg}", source.Name, ex.Message);
            Emit(source.Id, DiscoveryScanStatus.Failed, 0, 0, 0, "YouTube quota exceeded for today.");
        }
        catch (OperationCanceledException)
        {
            Emit(source.Id, DiscoveryScanStatus.Cancelled, 0, 0, 0, null);
            throw;
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Discovery scan {Source} failed", source.Name);
            Emit(source.Id, DiscoveryScanStatus.Failed, 0, 0, 0, ex.Message);
        }
        finally
        {
            progress.Complete(source.Id);
        }
    }

    private void Emit(Guid sourceId, DiscoveryScanStatus status, int total, int newItems, int confident, string? error,
        int updatedDates = 0, int checkedItems = 0)
        => progress.Publish(new DiscoveryScanProgress(sourceId, status, total, newItems, confident, error)
        {
            UpdatedDates = updatedDates,
            CheckedItems = checkedItems,
            FinishedAt = status is DiscoveryScanStatus.Completed or DiscoveryScanStatus.Failed or DiscoveryScanStatus.Cancelled ? DateTime.UtcNow : null,
        });
}
