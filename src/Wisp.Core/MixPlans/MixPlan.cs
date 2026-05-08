using Wisp.Core.Tracks;

namespace Wisp.Core.MixPlans;

public class MixPlan
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    /// Optional FK to a Playlist whose contents constrain the recommendation
    /// candidate pool when building this plan. Null = unconstrained (default).
    /// Cleared (set null) when the referenced playlist is deleted — we don't
    /// cascade-delete the plan itself, which would lose the user's tracks.
    public Guid? RecommendationScopePlaylistId { get; set; }

    public List<MixPlanTrack> Tracks { get; set; } = [];
}

public class MixPlanTrack
{
    public Guid Id { get; set; }
    public Guid MixPlanId { get; set; }
    public Guid TrackId { get; set; }

    /// Fractional ordering: midpoint inserts avoid reindexing on every drag.
    public double Order { get; set; }

    public double? CueInSeconds { get; set; }
    public double? CueOutSeconds { get; set; }
    public string? TransitionNotes { get; set; }

    /// "Must include" anchor — the route suggester treats anchored cards as fixed
    /// waypoints and only fills the gaps between them. Default false; toggled via the
    /// PATCH endpoint. Pure positional metadata, doesn't affect playback / scoring.
    public bool IsAnchor { get; set; }

    public Track? Track { get; set; }
}
