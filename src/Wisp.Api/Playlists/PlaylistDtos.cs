using Wisp.Api.Library;
using Wisp.Core.Playlists;

namespace Wisp.Api.Playlists;

public sealed record PlaylistSummaryDto(
    Guid Id,
    string Name,
    string? Notes,
    int TrackCount,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public sealed record PlaylistDto(
    Guid Id,
    string Name,
    string? Notes,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    IReadOnlyList<PlaylistTrackDto> Tracks);

public sealed record PlaylistTrackDto(
    Guid Id,
    Guid TrackId,
    DateTime AddedAt,
    TrackDto Track)
{
    public static PlaylistTrackDto From(PlaylistTrack pt) =>
        new(pt.Id, pt.TrackId, pt.AddedAt, TrackDto.From(pt.Track!));
}

public sealed record CreatePlaylistRequest(string Name, string? Notes);
public sealed record UpdatePlaylistRequest(string? Name, string? Notes);

public sealed record AddTrackToPlaylistRequest(Guid TrackId);
public sealed record AddTracksToPlaylistRequest(IReadOnlyList<Guid> TrackIds);
