namespace Wisp.Api.Discover;

/// One row in `DiscoverSearchResponse.Artists`. Spotify-only for now —
/// Spotify is the only source whose free API tier returns enough metadata
/// to render an artist card (image + follower count + genres).
public sealed record DiscoverArtistHit(
    string Source,                  // "Spotify"
    string ExternalId,
    string Name,
    long? Followers,
    string[] Genres,
    string? ImageUrl);

/// One row in `DiscoverSearchResponse.Videos`. Always YouTube for now.
public sealed record DiscoverVideoHit(
    string Source,                  // "YouTube"
    string VideoId,
    string Title,
    string ChannelTitle,
    string Url,
    string? ThumbnailUrl,
    DateTimeOffset? PublishedAt);

/// Quota meter shown in the UI so the user knows how many YouTube searches
/// they have left for the day. Resets at UTC midnight.
public sealed record DiscoverQuotaInfo(
    int SearchesToday,
    int DailyBudget,
    DateTimeOffset ResetUtc,
    bool Exhausted);

public sealed record DiscoverSearchResponse(
    string Query,
    DiscoverArtistHit[] Artists,
    DiscoverVideoHit[] Videos,
    DiscoverQuotaInfo? YouTubeQuota,    // null when YouTube wasn't queried
    string[] Errors);                   // surface "spotify_unconfigured" etc.
