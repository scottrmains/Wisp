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

    /// Crowd-friendly bias for events / parties: tighter BPM and energy caps than Safe,
    /// soft preference for tracks that have proven `Great`-rated transitions elsewhere
    /// in the library, and (when role tags exist) a boost for `peak-time / vocal / funky / classic`
    /// with a penalty for `dark / minimal / experimental`. Falls back cleanly when no tags exist.
    Party,
}
