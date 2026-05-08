using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Wisp.Core.Discovery;
using Wisp.Infrastructure.ExternalCatalog.Discogs;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Infrastructure.Discovery;

public class DigitalAvailabilityService(
    WispDbContext db,
    DiscogsCatalogClient discogs,
    ILogger<DigitalAvailabilityService> log)
{
    /// Run availability check for a single discovered track:
    ///   1. Query Discogs for "{artist} {title}" releases
    ///   2. Score each candidate with the confidence model
    ///   3. Persist DigitalMatch rows; classify availability heuristically
    ///   4. Always emit search-link fallbacks (Beatport / Juno / Bandcamp / Traxsource) so the user can dig further
    ///   5. Update the parent track's Status based on best-match band
    public async Task RunAsync(Guid discoveredTrackId, CancellationToken ct)
    {
        var disc = await db.DiscoveredTracks.FirstOrDefaultAsync(t => t.Id == discoveredTrackId, ct)
            ?? throw new InvalidOperationException("Discovered track not found.");

        if (string.IsNullOrEmpty(disc.ParsedArtist) || string.IsNullOrEmpty(disc.ParsedTitle))
            throw new InvalidOperationException("Track has no parsed artist/title to search with.");

        // Wipe and rebuild matches for this track — keeps things idempotent.
        var existing = await db.DigitalMatches.Where(m => m.DiscoveredTrackId == discoveredTrackId).ToListAsync(ct);
        if (existing.Count > 0) db.DigitalMatches.RemoveRange(existing);

        var now = DateTime.UtcNow;
        var bestScore = 0;

        if (discogs.IsConfigured)
        {
            try
            {
                await SearchDiscogsAsync(disc, now, ct);
                bestScore = await db.DigitalMatches
                    .Where(m => m.DiscoveredTrackId == discoveredTrackId && m.Source == "Discogs")
                    .Select(m => (int?)m.ConfidenceScore)
                    .MaxAsync(ct) ?? 0;
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Discogs search failed for {Title}", disc.RawTitle);
            }
        }

        // Search-link fallbacks — always present, even when API matches exist, so the user can dig further.
        AddSearchLinks(disc, now);

        disc.LastMatchedAt = now;
        disc.Status = ClassifyStatus(bestScore, disc.Status);

        await db.SaveChangesAsync(ct);
    }

    private async Task SearchDiscogsAsync(DiscoveredTrack disc, DateTime now, CancellationToken ct)
    {
        var query = $"{disc.ParsedArtist} {disc.ParsedTitle}";
        // Use the SearchArtistsAsync entry point for now? No — we need a release search.
        // The current DiscogsCatalogClient only exposes release-by-artist-id, not free-text release search.
        // For Phase 9 v1, search the artist on Discogs then fetch their releases and score against the title.
        // This is heavier than a direct release search but reuses what we already have without API changes.
        var artistCandidates = await discogs.SearchArtistsAsync(disc.ParsedArtist!, limit: 3, ct);
        if (artistCandidates.Count == 0) return;

        // Use the highest-ranked artist match (Discogs ranks by relevance already).
        var artistId = artistCandidates[0].ExternalId;
        var releases = await discogs.GetArtistReleasesAsync(artistId, ct);

        foreach (var rel in releases)
        {
            var score = ConfidenceScoring.Score(new ScoreInputs(
                DiscoveredArtist: disc.ParsedArtist,
                DiscoveredTitle: disc.ParsedTitle,
                DiscoveredVersion: disc.MixVersion,
                DiscoveredYear: disc.ReleaseYear,
                CandidateArtist: disc.ParsedArtist!, // Discogs doesn't return artist per release in this shape; we trust the artist match
                CandidateTitle: rel.Title,
                CandidateVersion: null,              // Discogs release titles already include version markers
                CandidateLabel: null,
                CandidateYear: rel.ReleaseDate?.Year));

            if (score < 50) continue; // ignore weak matches

            db.DigitalMatches.Add(new DigitalMatch
            {
                Id = Guid.NewGuid(),
                DiscoveredTrackId = disc.Id,
                Source = "Discogs",
                ExternalId = rel.ExternalId,
                Url = rel.Url ?? "",
                Artist = disc.ParsedArtist!,
                Title = rel.Title,
                Version = null,
                Label = null,
                Year = rel.ReleaseDate?.Year,
                Availability = ClassifyDiscogsAvailability(rel.ReleaseType),
                ConfidenceScore = score,
                MatchedAt = now,
            });
        }
    }

    private void AddSearchLinks(DiscoveredTrack disc, DateTime now)
    {
        var q = $"{disc.ParsedArtist} {disc.ParsedTitle}";
        var enc = Uri.EscapeDataString(q);

        var stores = new (string Source, string Url)[]
        {
            ("Beatport", $"https://www.beatport.com/search?q={enc}"),
            ("Juno", $"https://www.juno.co.uk/search/?q[all][]={enc}"),
            ("Traxsource", $"https://www.traxsource.com/search?term={enc}"),
            ("Bandcamp", $"https://bandcamp.com/search?q={enc}&item_type=t"),
        };

        foreach (var (source, url) in stores)
        {
            db.DigitalMatches.Add(new DigitalMatch
            {
                Id = Guid.NewGuid(),
                DiscoveredTrackId = disc.Id,
                Source = source,
                ExternalId = $"search:{q}",
                Url = url,
                Artist = disc.ParsedArtist ?? "",
                Title = disc.ParsedTitle ?? "",
                Availability = MatchAvailability.SearchLink,
                ConfidenceScore = 0, // search links aren't scored — they're a fallback action
                MatchedAt = now,
            });
        }
    }

    private static MatchAvailability ClassifyDiscogsAvailability(string releaseType) =>
        releaseType.ToLowerInvariant() switch
        {
            "ep" or "single" or "album" or "compilation" => MatchAvailability.PhysicalOnly,
            _ => MatchAvailability.Unknown,
        };

    private static DiscoveryStatus ClassifyStatus(int bestScore, DiscoveryStatus current)
    {
        // Don't overwrite user-driven statuses — they made a deliberate choice.
        if (current is DiscoveryStatus.Want or DiscoveryStatus.AlreadyHave or DiscoveryStatus.Ignore)
            return current;

        return bestScore switch
        {
            >= 90 => DiscoveryStatus.DigitalAvailable,
            >= 70 => DiscoveryStatus.PossibleMatch,
            >= 50 => DiscoveryStatus.PossibleMatch,
            _ => DiscoveryStatus.NoMatch,
        };
    }
}
