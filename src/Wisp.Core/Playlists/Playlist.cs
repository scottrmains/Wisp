using Wisp.Core.Tracks;

namespace Wisp.Core.Playlists;

/// User-curated bucket of tracks. Distinct from MixPlan in two ways:
///   1. **Unordered** — playlists don't carry transition / cue / chain semantics.
///      They're just sets of tracks the user grouped together.
///   2. **Reusable as a recommendation scope** — a MixPlan can point at a playlist
///      via `RecommendationScopePlaylistId` to constrain what gets suggested when
///      building it. That's the real payoff.
public class Playlist
{
    public Guid Id { get; set; }

    public string Name { get; set; } = "";
    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public List<PlaylistTrack> Tracks { get; set; } = [];
}

public class PlaylistTrack
{
    public Guid Id { get; set; }
    public Guid PlaylistId { get; set; }
    public Guid TrackId { get; set; }

    /// When the user added this track to the playlist. Used for the default
    /// ordering — newest at the top — when listing playlist contents.
    public DateTime AddedAt { get; set; }

    public Track? Track { get; set; }
}
