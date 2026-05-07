namespace Wisp.Core.Recommendations;

public enum RecommendationMode
{
    /// Same / adjacent key, close BPM, similar energy. Beginner-safe.
    Safe,

    /// Prefer +1 or +2 energy moves while staying mixable.
    EnergyUp,

    /// Prefer -1 or -2 energy moves.
    EnergyDown,

    /// Prioritise genre and similar sonic feel; energy stable.
    SameVibe,

    /// Allow slightly riskier key/BPM moves.
    Creative,

    /// Looser scoring across the board for unexpected but plausible picks.
    Wildcard,
}
