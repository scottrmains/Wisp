using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Wisp.Core.ArtistRefresh;
using Wisp.Infrastructure.ExternalCatalog;
using Wisp.Infrastructure.ExternalCatalog.Spotify;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Infrastructure.ArtistRefresh;

public sealed record ArtistSummary(
    Guid Id,
    string Name,
    int TrackCount,
    int? LatestLocalYear,
    int NewReleaseCount,
    bool IsMatched,
    DateTime? LastCheckedAt);

public class ArtistRefreshService(
    WispDbContext db,
    SpotifyCatalogClient spotify,
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

        // Aggregate library stats per normalized artist name.
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
                    IsMatched: !string.IsNullOrEmpty(p.SpotifyArtistId),
                    LastCheckedAt: p.LastCheckedAt);
            })
            .Where(s => s.TrackCount > 0)
            .OrderByDescending(s => s.NewReleaseCount)
            .ThenByDescending(s => s.TrackCount)
            .ToList();
    }

    public async Task<IReadOnlyList<CatalogArtistCandidate>> GetMatchCandidatesAsync(
        Guid artistId, CancellationToken ct)
    {
        var artist = await db.ArtistProfiles.AsNoTracking().FirstOrDefaultAsync(a => a.Id == artistId, ct)
            ?? throw new InvalidOperationException("Artist profile not found.");

        return await spotify.SearchArtistsAsync(artist.Name, limit: 8, ct);
    }

    public async Task<ArtistProfile> AssignSpotifyMatchAsync(Guid artistId, string spotifyArtistId, CancellationToken ct)
    {
        var artist = await db.ArtistProfiles.FirstOrDefaultAsync(a => a.Id == artistId, ct)
            ?? throw new InvalidOperationException("Artist profile not found.");
        artist.SpotifyArtistId = spotifyArtistId;
        await db.SaveChangesAsync(ct);
        return artist;
    }

    /// Pull releases for an artist from Spotify and reconcile against local library.
    /// Idempotent — re-running updates `IsAlreadyInLibrary` flags on existing rows.
    public async Task<int> RefreshAsync(Guid artistId, CancellationToken ct)
    {
        var artist = await db.ArtistProfiles.FirstOrDefaultAsync(a => a.Id == artistId, ct)
            ?? throw new InvalidOperationException("Artist profile not found.");
        if (string.IsNullOrEmpty(artist.SpotifyArtistId))
            throw new InvalidOperationException("Artist has no Spotify match yet.");

        var releases = await spotify.GetArtistAlbumsAsync(artist.SpotifyArtistId, ct);

        // Pull existing rows for this artist+source so we can update in place.
        var existingRows = await db.ExternalReleases
            .Where(r => r.ArtistProfileId == artistId && r.Source == "Spotify")
            .ToListAsync(ct);
        var byId = existingRows.ToDictionary(r => r.ExternalId);

        // Pull library titles by this artist for overlap detection.
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
                    ArtistProfileId = artistId,
                    Source = "Spotify",
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

        artist.LastCheckedAt = now;
        await db.SaveChangesAsync(ct);
        log.LogInformation("Refreshed {Artist}: {Inserted} new, {Total} total releases tracked",
            artist.Name, inserted, releases.Count);
        return inserted;
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
