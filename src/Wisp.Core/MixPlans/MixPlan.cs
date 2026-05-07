using Wisp.Core.Tracks;

namespace Wisp.Core.MixPlans;

public class MixPlan
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

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

    public Track? Track { get; set; }
}
