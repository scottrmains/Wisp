using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Wisp.Core.ArtistRefresh;
using Wisp.Infrastructure.ArtistRefresh;
using Wisp.Infrastructure.ExternalCatalog.Spotify;
using Wisp.Infrastructure.ExternalCatalog.YouTube;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Discover;

/// HTTP API for the Discover page's "Anywhere" search mode. Hits Spotify
/// (artists) and YouTube (videos) in parallel — the UI renders each block
/// independently so a 401 from one doesn't blank the other.
///
/// **YouTube budget:** `search.list` is 100 quota units / call against a
/// default 10k/day allowance. The YouTubeQuotaTracker singleton:
///   • caches results per-query for the day so the same typing burst
///     doesn't burn quota on every keystroke
///   • hard-caps at 90 calls/day so non-search YouTube traffic (channel
///     resolves, playlistItems pages from Crate Digger) stays funded
///   • returns a snapshot in the response so the UI can show the meter
public static class DiscoverEndpoints
{
    public static IEndpointRouteBuilder MapDiscover(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/discover/search", Search);
        app.MapPost("/api/discover/follow", Follow);
        return app;
    }

    /// Follow a Spotify artist that came back from /discover/search but isn't
    /// in the user's library. Creates (or reuses) an ArtistProfile, attaches
    /// the Spotify ID, and kicks an initial refresh so the user immediately
    /// sees recent releases. Idempotent on (NormalizedName) — clicking
    /// Follow twice on the same artist returns the same row.
    private static async Task<IResult> Follow(
        FollowArtistRequest body,
        WispDbContext db,
        ArtistRefreshService svc,
        ILogger<ArtistRefreshService> log,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Name) || string.IsNullOrWhiteSpace(body.SpotifyArtistId))
        {
            return Results.BadRequest(new
            {
                code = "missing_fields",
                message = "Name and SpotifyArtistId are required.",
            });
        }

        var name = body.Name.Trim();
        var normalized = ArtistNormalizer.Normalize(name);
        if (string.IsNullOrEmpty(normalized))
        {
            return Results.BadRequest(new { code = "invalid_name", message = "Name is empty after normalization." });
        }

        // Find-or-create. The unique index on NormalizedName means we can't
        // double-insert; we either return the existing row or land a new one.
        var artist = await db.ArtistProfiles.FirstOrDefaultAsync(a => a.NormalizedName == normalized, ct);
        if (artist is null)
        {
            artist = new ArtistProfile
            {
                Id = Guid.NewGuid(),
                Name = name,
                NormalizedName = normalized,
                CreatedAt = DateTime.UtcNow,
            };
            db.ArtistProfiles.Add(artist);
        }
        artist.SpotifyArtistId = body.SpotifyArtistId;
        await db.SaveChangesAsync(ct);

        // Initial refresh so the user sees releases right away. Failures here
        // shouldn't reverse the follow — the artist is now in the list and
        // can be re-refreshed manually.
        try
        {
            await svc.RefreshAsync(artist.Id, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Initial refresh after Follow failed for artist {ArtistId}", artist.Id);
        }

        return Results.Ok(new
        {
            id = artist.Id,
            name = artist.Name,
            spotifyArtistId = artist.SpotifyArtistId,
        });
    }

    private static async Task<IResult> Search(
        string? q,
        string? sources,
        SpotifyCatalogClient spotify,
        YouTubeCatalogClient youTube,
        YouTubeQuotaTracker quota,
        ILogger<YouTubeCatalogClient> log,
        CancellationToken ct)
    {
        var query = (q ?? string.Empty).Trim();
        if (query.Length < 2)
        {
            return Results.Ok(new DiscoverSearchResponse(
                Query: query,
                Artists: [],
                Videos: [],
                YouTubeQuota: null,
                Errors: []));
        }

        // `sources` is comma-delimited e.g. "spotify,youtube". Default is both.
        // Empty string disables — the UI uses this when the user toggles a
        // source off in the chip strip.
        var sourceSet = (sources ?? "spotify,youtube")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => s.ToLowerInvariant())
            .ToHashSet();

        var errors = new List<string>();

        // Run the two source calls in parallel. Each has its own try/catch
        // so a Spotify auth failure doesn't blank the YouTube panel + vice
        // versa. The UI renders source-specific empty states from the
        // errors[] array.
        var spotifyTask = sourceSet.Contains("spotify")
            ? FetchSpotifyAsync(spotify, query, errors, log, ct)
            : Task.FromResult<DiscoverArtistHit[]>([]);
        var youtubeTask = sourceSet.Contains("youtube")
            ? FetchYouTubeAsync(youTube, quota, query, errors, log, ct)
            : Task.FromResult<DiscoverVideoHit[]>([]);

        await Task.WhenAll(spotifyTask, youtubeTask);

        // Snapshot the YouTube quota even if the user has it disabled this
        // call — lets the UI render the meter regardless.
        DiscoverQuotaInfo? quotaDto = null;
        if (sourceSet.Contains("youtube"))
        {
            var snap = quota.Snapshot();
            quotaDto = new DiscoverQuotaInfo(
                SearchesToday: snap.SearchesToday,
                DailyBudget: snap.DailyBudget,
                ResetUtc: snap.ResetUtc,
                Exhausted: snap.SearchesToday >= snap.DailyBudget);
        }

        return Results.Ok(new DiscoverSearchResponse(
            Query: query,
            Artists: spotifyTask.Result,
            Videos: youtubeTask.Result,
            YouTubeQuota: quotaDto,
            Errors: errors.ToArray()));
    }

    private static async Task<DiscoverArtistHit[]> FetchSpotifyAsync(
        SpotifyCatalogClient spotify,
        string query,
        List<string> errors,
        ILogger log,
        CancellationToken ct)
    {
        if (!spotify.IsConfigured)
        {
            errors.Add("spotify_unconfigured");
            return [];
        }

        try
        {
            var hits = await spotify.SearchArtistsAsync(query, limit: 10, ct);
            return hits
                .Select(h => new DiscoverArtistHit(
                    Source: h.Source,
                    ExternalId: h.ExternalId,
                    Name: h.Name,
                    Followers: h.Followers,
                    Genres: h.Genres.ToArray(),
                    ImageUrl: h.ImageUrl))
                .ToArray();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Spotify search for '{Query}' failed", query);
            errors.Add("spotify_failed");
            return [];
        }
    }

    private static async Task<DiscoverVideoHit[]> FetchYouTubeAsync(
        YouTubeCatalogClient youTube,
        YouTubeQuotaTracker quota,
        string query,
        List<string> errors,
        ILogger log,
        CancellationToken ct)
    {
        // Cache check first so today's repeat queries don't even reach the
        // budget. Trim+lowercase normalisation handled inside the tracker.
        var cached = quota.TryGetCached(query);
        if (cached is not null) return cached.Select(ToDto).ToArray();

        if (!youTube.IsConfigured)
        {
            errors.Add("youtube_unconfigured");
            return [];
        }

        // Two parallel YouTube paths feed the result block:
        //   1) `SearchVideosAsync` — general video search, music-category-
        //      filtered. Catches non-Topic content (mixes, fan uploads of
        //      track IDs, edits) and unmatched track-name queries.
        //   2) `GetArtistTopicUploadsAsync` — resolves the artist's Topic
        //      channel and lists its uploads. This is the path that turns
        //      "Jasper Tygner" from "5 unrelated mix recordings" into
        //      "his actual catalogue" because Topic channels carry the
        //      official licensed releases.
        // Both consume one search.list call (100 units each). We charge
        // the budget once per overall request and let YouTube's own quota
        // surface the hard cap if we ever overshoot.
        if (!quota.TryConsume())
        {
            errors.Add("youtube_quota_exhausted");
            return [];
        }

        var videoTask = TryAsync(() => youTube.SearchVideosAsync(query, limit: 10, ct), log, "YouTube video search");
        var topicTask = TryAsync(() => youTube.GetArtistTopicUploadsAsync(query, maxUploads: 50, ct), log, "YouTube Topic uploads");

        var videos = await videoTask;
        var topic = await topicTask;

        if (videos is null && topic is null)
        {
            // Both calls threw — surface as failure so UI can show the banner.
            errors.Add("youtube_failed");
            return [];
        }

        // Detect quota exhaustion via the dedicated exception → cap our
        // local counter so subsequent requests skip cleanly.
        if (videos is QuotaExhaustedSentinel || topic is QuotaExhaustedSentinel)
        {
            errors.Add("youtube_quota_exhausted");
            // Continue with whichever side did succeed.
        }

        var videoHits = videos is QuotaExhaustedSentinel ? [] : videos ?? [];
        var topicHits = topic is QuotaExhaustedSentinel ? [] : topic ?? [];

        // Topic uploads first — they're the more relevant "this is the
        // artist's catalogue" hits. Then the looser video search rows
        // backfill via a videoId-keyed dedupe.
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var merged = new List<YouTubeVideoHit>(topicHits.Count + videoHits.Count);
        foreach (var h in topicHits)
            if (seen.Add(h.VideoId)) merged.Add(h);
        foreach (var h in videoHits)
            if (seen.Add(h.VideoId)) merged.Add(h);

        // Cap the merged list — too many rows turn the page into a wall
        // of thumbnails. 24 is enough for two grid rows on a wide screen
        // plus a bit more.
        var capped = merged.Take(24).ToArray();
        quota.Cache(query, capped);
        return capped.Select(ToDto).ToArray();
    }

    /// Wrapper used to flag quota-exhausted vs other failures from the
    /// parallel YouTube tasks without throwing across `await Task.WhenAll`.
    private sealed class QuotaExhaustedSentinel : List<YouTubeVideoHit> { }

    private static async Task<IReadOnlyList<YouTubeVideoHit>?> TryAsync(
        Func<Task<IReadOnlyList<YouTubeVideoHit>>> action,
        ILogger log,
        string label)
    {
        try
        {
            return await action();
        }
        catch (YouTubeQuotaExceededException)
        {
            return new QuotaExhaustedSentinel();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "{Label} failed", label);
            return null;
        }
    }

    private static DiscoverVideoHit ToDto(YouTubeVideoHit h) => new(
        Source: "YouTube",
        VideoId: h.VideoId,
        Title: h.Title,
        ChannelTitle: h.ChannelTitle,
        Url: h.Url,
        ThumbnailUrl: h.ThumbnailUrl,
        PublishedAt: h.PublishedAt);
}

