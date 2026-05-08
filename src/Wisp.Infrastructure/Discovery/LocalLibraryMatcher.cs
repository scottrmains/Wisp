using Microsoft.EntityFrameworkCore;
using Wisp.Core.Discovery;
using Wisp.Infrastructure.ArtistRefresh;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Infrastructure.Discovery;

/// Decides whether a discovered track matches something already in the local library —
/// based on normalized artist + normalized title (mix versions stripped). High confidence
/// only; on uncertainty we leave IsAlreadyInLibrary false.
public class LocalLibraryMatcher(WispDbContext db)
{
    public async Task<int> ReconcileAsync(Guid? discoveredTrackId, CancellationToken ct)
    {
        IQueryable<DiscoveredTrack> q = db.DiscoveredTracks;
        if (discoveredTrackId.HasValue) q = q.Where(t => t.Id == discoveredTrackId.Value);

        var discoveredAll = await q.ToListAsync(ct);
        if (discoveredAll.Count == 0) return 0;

        var library = await db.Tracks.AsNoTracking()
            .Where(t => t.Artist != null && t.Title != null)
            .Select(t => new { t.Id, t.Artist, t.Title })
            .ToListAsync(ct);

        // Index local library by (normArtist, normTitle) for O(1) lookup.
        var byKey = library
            .GroupBy(t => Key(ArtistNormalizer.Normalize(t.Artist!), TitleOverlap.Normalize(t.Title!)))
            .Where(g => !string.IsNullOrEmpty(g.Key))
            .ToDictionary(g => g.Key, g => g.First().Id);

        var reconciled = 0;
        foreach (var disc in discoveredAll)
        {
            if (string.IsNullOrEmpty(disc.ParsedArtist) || string.IsNullOrEmpty(disc.ParsedTitle)) continue;
            var key = Key(
                ArtistNormalizer.Normalize(disc.ParsedArtist),
                TitleOverlap.Normalize(disc.ParsedTitle));

            if (string.IsNullOrEmpty(key)) continue;

            if (byKey.TryGetValue(key, out var localId))
            {
                if (!disc.IsAlreadyInLibrary || disc.MatchedLocalTrackId != localId)
                {
                    disc.IsAlreadyInLibrary = true;
                    disc.MatchedLocalTrackId = localId;
                    if (disc.Status == DiscoveryStatus.New) disc.Status = DiscoveryStatus.AlreadyHave;
                    reconciled++;
                }
            }
            else if (disc.IsAlreadyInLibrary)
            {
                // Library track was removed/renamed — clear the flag.
                disc.IsAlreadyInLibrary = false;
                disc.MatchedLocalTrackId = null;
                if (disc.Status == DiscoveryStatus.AlreadyHave) disc.Status = DiscoveryStatus.New;
                reconciled++;
            }
        }

        await db.SaveChangesAsync(ct);
        return reconciled;
    }

    private static string Key(string artist, string title) =>
        string.IsNullOrEmpty(artist) || string.IsNullOrEmpty(title) ? "" : $"{artist}{title}";
}
