using Wisp.Core.Wanted;

namespace Wisp.Api.Wanted;

public sealed record WantedTrackDto(
    Guid Id,
    WantedSource Source,
    string Artist,
    string Title,
    string? SourceVideoId,
    string? SourceUrl,
    string? ThumbnailUrl,
    string? Notes,
    Guid? MatchedLocalTrackId,
    DateTime? MatchedAt,
    DateTime AddedAt)
{
    public static WantedTrackDto From(WantedTrack w) => new(
        w.Id,
        w.Source,
        w.Artist,
        w.Title,
        w.SourceVideoId,
        w.SourceUrl,
        w.ThumbnailUrl,
        w.Notes,
        w.MatchedLocalTrackId,
        w.MatchedAt,
        w.AddedAt);
}

public sealed record CreateWantedTrackRequest(
    WantedSource Source,
    string Artist,
    string Title,
    string? SourceVideoId,
    string? SourceUrl,
    string? ThumbnailUrl,
    string? Notes);
