using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Wisp.Core.ArtistRefresh;
using Wisp.Infrastructure.ExternalCatalog;
using Wisp.Infrastructure.ExternalCatalog.Discogs;
using Wisp.Infrastructure.ExternalCatalog.Spotify;
using Wisp.Infrastructure.ExternalCatalog.YouTube;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Infrastructure.ArtistRefresh;

public sealed record ArtistSummary(
    Guid Id,
    string Name,
    int TrackCount,
    int? LatestLocalYear,
    int NewReleaseCount,
    bool IsMatchedSpotify,
    bool IsMatchedDiscogs,
    bool IsMatchedYouTube,
    DateTime? LastCheckedAt);

/// Source string constants — keep on the wire as strings, but typed inside.
public static class CatalogSources
{
    public const string Spotify = "Spotify";
    public const string Discogs = "Discogs";
    public const string YouTube = "YouTube";
}

public class ArtistRefreshService(
    WispDbContext db,
    SpotifyCatalogClient spotify,
    DiscogsCatalogClient discogs,
    YouTubeCatalogClient youTube,
    ILogger<ArtistRefreshService> log)
{
    /// Idempotently project distinct Track.Artist values into ArtistProfile rows.
    public async Task EnsureProfilesFromLibraryAsync(CancellationToken ct)
    {
        var distinctNames = await db.Tracks
            .AsNoTracking()
            .Where(t => t.Artist != null && t.Artist != "")
            .Select(t => t.Artist!)
            .Distinct()
            .ToListAsync(ct);

        var existing = await db.ArtistProfiles
            .Select(a => a.NormalizedName)
            .ToListAsync(ct);
        var have = new HashSet<string>(existing, StringComparer.OrdinalIgnoreCase);

        var now = DateTime.UtcNow;
        foreach (var raw in distinctNames)
        {
            var normalized = ArtistNormalizer.Normalize(raw);
            if (string.IsNullOrEmpty(normalized) || have.Contains(normalized)) continue;

            db.ArtistProfiles.Add(new ArtistProfile
            {
                Id = Guid.NewGuid(),
                Name = raw.Trim(),
                NormalizedName = normalized,
                CreatedAt = now,
            });
            have.Add(normalized);
        }
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<ArtistSummary>> ListAsync(CancellationToken ct)
    {
        await EnsureProfilesFromLibraryAsync(ct);

        var stats = await db.Tracks.AsNoTracking()
            .Where(t => t.Artist != null && t.Artist != "")
            .Select(t => new { t.Artist, t.ReleaseYear })
            .ToListAsync(ct);

        var byNorm = stats
            .GroupBy(t => ArtistNormalizer.Normalize(t.Artist!))
            .ToDictionary(
                g => g.Key,
                g => new
                {
                    Count = g.Count(),
                    LatestYear = g.Where(t => t.ReleaseYear.HasValue).Max(t => t.ReleaseYear),
                });

        var profiles = await db.ArtistProfiles.AsNoTracking().ToListAsync(ct);
        var releaseCounts = await db.ExternalReleases.AsNoTracking()
            .Where(r => !r.IsDismissed && !r.IsAlreadyInLibrary)
            .GroupBy(r => r.ArtistProfileId)
            .Select(g => new { ArtistProfileId = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        var releasesByArtist = releaseCounts.ToDictionary(x => x.ArtistProfileId, x => x.Count);

        return profiles
            .Select(p =>
            {
                byNorm.TryGetValue(p.NormalizedName, out var s);
                return new ArtistSummary(
                    Id: p.Id,
                    Name: p.Name,
                    TrackCount: s?.Count ?? 0,
                    LatestLocalYear: s?.LatestYear,
                    NewReleaseCount: releasesByArtist.GetValueOrDefault(p.Id, 0),
                    IsMatchedSpotify: !string.IsNullOrEmpty(p.SpotifyArtistId),
                    IsMatchedDiscogs: !string.IsNullOrEmpty(p.DiscogsArtistId),
                    IsMatchedYouTube: !string.IsNullOrEmpty(p.YouTubeChannelId),
                    LastCheckedAt: p.LastCheckedAt);
            })
            .Where(s => s.TrackCount > 0)
            .OrderByDescending(s => s.NewReleaseCount)
            .ThenByDescending(s => s.TrackCount)
            .ToList();
    }

    public async Task<IReadOnlyList<CatalogArtistCandidate>> GetMatchCandidatesAsync(
        Guid artistId, string source, CancellationToken ct)
    {
        var artist = await db.ArtistProfiles.AsNoTracking().FirstOrDefaultAsync(a => a.Id == artistId, ct)
            ?? throw new InvalidOperationException("Artist profile not found.");

        return source switch
        {
            CatalogSources.Spotify => await spotify.SearchArtistsAsync(artist.Name, limit: 8, ct),
            CatalogSources.Discogs => await discogs.SearchArtistsAsync(artist.Name, limit: 10, ct),
            CatalogSources.YouTube => await youTube.SearchTopicChannelsAsync(artist.Name, limit: 5, ct),
            _ => throw new ArgumentException($"Unknown source '{source}'."),
        };
    }

    public async Task<ArtistProfile> AssignMatchAsync(
        Guid artistId, string source, string externalId, CancellationToken ct)
    {
        var artist = await db.ArtistProfiles.FirstOrDefaultAsync(a => a.Id == artistId, ct)
            ?? throw new InvalidOperationException("Artist profile not found.");

        switch (source)
        {
            case CatalogSources.Spotify: artist.SpotifyArtistId = externalId; break;
            case CatalogSources.Discogs: artist.DiscogsArtistId = externalId; break;
            case CatalogSources.YouTube: artist.YouTubeChannelId = externalId; break;
            default: throw new ArgumentException($"Unknown source '{source}'.");
        }

        await db.SaveChangesAsync(ct);
        return artist;
    }

    /// Pull releases from every matched source and reconcile against local library.
    /// YouTube is treated as an enrichment layer — uploads are matched against existing
    /// release rows by title, populating YouTubeVideoId/YouTubeUrl when found.
    /// Returns the count of newly inserted release rows across all sources.
    public async Task<int> RefreshAsync(Guid artistId, CancellationToken ct)
    {
        var artist = await db.ArtistProfiles.FirstOrDefaultAsync(a => a.Id == artistId, ct)
            ?? throw new InvalidOperationException("Artist profile not found.");

        var matched = false;
        var totalInserted = 0;

        if (!string.IsNullOrEmpty(artist.SpotifyArtistId))
        {
            matched = true;
            var releases = await spotify.GetArtistAlbumsAsync(artist.SpotifyArtistId, ct);
            totalInserted += await UpsertReleasesAsync(artist, CatalogSources.Spotify, releases, ct);
        }
        if (!string.IsNullOrEmpty(artist.DiscogsArtistId))
        {
            matched = true;
            var releases = await discogs.GetArtistReleasesAsync(artist.DiscogsArtistId, ct);
            totalInserted += await UpsertReleasesAsync(artist, CatalogSources.Discogs, releases, ct);
        }

        // YouTube enrichment — fetch the Topic channel uploads and match them to existing
        // releases by title. We persist the inserts/updates from the loop above before this
        // step so the matcher sees the just-fetched releases too.
        if (!string.IsNullOrEmpty(artist.YouTubeChannelId))
        {
            matched = true;
            await db.SaveChangesAsync(ct);
            await EnrichWithYouTubeUploadsAsync(artist, ct);
        }

        if (!matched)
            throw new InvalidOperationException("Artist has no source matches yet.");

        artist.LastCheckedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        log.LogInformation("Refreshed {Artist}: {Inserted} new releases across sources", artist.Name, totalInserted);
        return totalInserted;
    }

    private async Task<int> UpsertReleasesAsync(
        ArtistProfile artist,
        string source,
        IReadOnlyList<CatalogReleaseSummary> releases,
        CancellationToken ct)
    {
        var existingRows = await db.ExternalReleases
            .Where(r => r.ArtistProfileId == artist.Id && r.Source == source)
            .ToListAsync(ct);
        var byId = existingRows.ToDictionary(r => r.ExternalId);

        var libraryTitles = await db.Tracks.AsNoTracking()
            .Where(t => t.Artist != null && t.Title != null)
            .Select(t => new { t.Id, t.Artist, t.Title })
            .ToListAsync(ct);

        var artistLibTitles = libraryTitles
            .Where(t => ArtistNormalizer.Normalize(t.Artist!) == artist.NormalizedName)
            .Select(t => new { t.Id, NormTitle = TitleOverlap.Normalize(t.Title!) })
            .Where(t => !string.IsNullOrEmpty(t.NormTitle))
            .ToList();

        var inserted = 0;
        var now = DateTime.UtcNow;

        foreach (var r in releases)
        {
            var matched = artistLibTitles.FirstOrDefault(t => t.NormTitle == TitleOverlap.Normalize(r.Title));
            var (alreadyInLibrary, matchedTrackId) = matched is not null
                ? (true, (Guid?)matched.Id)
                : (false, (Guid?)null);

            if (byId.TryGetValue(r.ExternalId, out var row))
            {
                row.Title = r.Title;
                row.ReleaseType = ParseReleaseType(r.ReleaseType);
                row.ReleaseDate = r.ReleaseDate;
                row.Url = r.Url;
                row.ArtworkUrl = r.ArtworkUrl;
                row.IsAlreadyInLibrary = alreadyInLibrary;
                row.MatchedLocalTrackId = matchedTrackId;
                row.FetchedAt = now;
            }
            else
            {
                db.ExternalReleases.Add(new ExternalRelease
                {
                    Id = Guid.NewGuid(),
                    ArtistProfileId = artist.Id,
                    Source = source,
                    ExternalId = r.ExternalId,
                    Title = r.Title,
                    ReleaseType = ParseReleaseType(r.ReleaseType),
                    ReleaseDate = r.ReleaseDate,
                    Url = r.Url,
                    ArtworkUrl = r.ArtworkUrl,
                    IsAlreadyInLibrary = alreadyInLibrary,
                    MatchedLocalTrackId = matchedTrackId,
                    FetchedAt = now,
                });
                inserted++;
            }
        }

        return inserted;
    }

    private async Task EnrichWithYouTubeUploadsAsync(ArtistProfile artist, CancellationToken ct)
    {
        try
        {
            var uploads = await youTube.GetTopicChannelUploadsAsync(artist.YouTubeChannelId!, ct);
            if (uploads.Count == 0) return;

            // Index uploads by normalized title for O(1) lookup against each release.
            var uploadsByTitle = uploads
                .Select(u => new { Norm = TitleOverlap.Normalize(u.Title), Upload = u })
                .Where(x => !string.IsNullOrEmpty(x.Norm))
                .GroupBy(x => x.Norm)
                .ToDictionary(g => g.Key, g => g.First().Upload);

            var releases = await db.ExternalReleases
                .Where(r => r.ArtistProfileId == artist.Id)
                .ToListAsync(ct);

            var enriched = 0;
            foreach (var release in releases)
            {
                if (!string.IsNullOrEmpty(release.YouTubeVideoId)) continue;
                var norm = TitleOverlap.Normalize(release.Title);
                if (string.IsNullOrEmpty(norm)) continue;

                if (uploadsByTitle.TryGetValue(norm, out var upload))
                {
                    release.YouTubeVideoId = upload.VideoId;
                    release.YouTubeUrl = upload.Url;
                    enriched++;
                }
            }
            log.LogInformation("YouTube: enriched {Count}/{Total} releases for {Artist}",
                enriched, releases.Count, artist.Name);
        }
        catch (YouTubeQuotaExceededException)
        {
            log.LogWarning("YouTube quota exceeded while enriching {Artist} — skipping", artist.Name);
        }
    }

    private static ReleaseType ParseReleaseType(string raw) => raw.ToLowerInvariant() switch
    {
        "album" => ReleaseType.Album,
        "single" => ReleaseType.Single,
        "ep" => ReleaseType.Ep,
        "compilation" => ReleaseType.Compilation,
        "appears_on" => ReleaseType.AppearsOn,
        _ => ReleaseType.Unknown,
    };
}
