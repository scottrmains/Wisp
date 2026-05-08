using Wisp.Core.ArtistRefresh;
using Wisp.Infrastructure.ArtistRefresh;
using Wisp.Infrastructure.ExternalCatalog;

namespace Wisp.Api.ArtistRefresh;

public sealed record ArtistSummaryDto(
    Guid Id,
    string Name,
    int TrackCount,
    int? LatestLocalYear,
    int NewReleaseCount,
    bool IsMatchedSpotify,
    bool IsMatchedDiscogs,
    bool IsMatchedYouTube,
    DateTime? LastCheckedAt)
{
    public static ArtistSummaryDto From(ArtistSummary s) => new(
        s.Id, s.Name, s.TrackCount, s.LatestLocalYear, s.NewReleaseCount,
        s.IsMatchedSpotify, s.IsMatchedDiscogs, s.IsMatchedYouTube, s.LastCheckedAt);
}

public sealed record CandidateDto(
    string Source,
    string ExternalId,
    string Name,
    int? Followers,
    string[] Genres,
    string? ImageUrl)
{
    public static CandidateDto From(CatalogArtistCandidate c) => new(
        c.Source, c.ExternalId, c.Name, c.Followers, c.Genres, c.ImageUrl);
}

public sealed record AssignMatchRequest(string Source, string ExternalId);

public sealed record ReleaseDto(
    Guid Id,
    Guid ArtistProfileId,
    string Source,
    string ExternalId,
    string Title,
    ReleaseType ReleaseType,
    DateOnly? ReleaseDate,
    string? Url,
    string? ArtworkUrl,
    bool IsAlreadyInLibrary,
    Guid? MatchedLocalTrackId,
    bool IsDismissed,
    bool IsSavedForLater,
    string? YouTubeVideoId,
    string? YouTubeUrl,
    DateTime FetchedAt)
{
    public static ReleaseDto From(ExternalRelease r) => new(
        r.Id, r.ArtistProfileId, r.Source, r.ExternalId, r.Title, r.ReleaseType, r.ReleaseDate,
        r.Url, r.ArtworkUrl, r.IsAlreadyInLibrary, r.MatchedLocalTrackId,
        r.IsDismissed, r.IsSavedForLater, r.YouTubeVideoId, r.YouTubeUrl, r.FetchedAt);
}

public sealed record UpdateReleaseRequest(bool? IsDismissed, bool? IsSavedForLater);
