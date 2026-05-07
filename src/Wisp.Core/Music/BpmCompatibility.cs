namespace Wisp.Core.Music;

public enum BpmRelation
{
    Same,    // candidate is at the same tempo
    Half,    // candidate is at half-time (e.g. 63 vs 126)
    Double,  // candidate is at double-time (e.g. 252 vs 126)
}

public sealed record BpmScore(int Points, BpmRelation Relation, decimal EffectiveDistance);

public static class BpmCompatibility
{
    /// Per spec §7.3:
    ///   diff <= 1   → 30
    ///   diff <= 2   → 25
    ///   diff <= 4   → 18
    ///   diff <= 6   → 10
    ///   beyond      → 0
    /// Half/double-time matches are scored on the *effective* distance and
    /// down-weighted by 0.85 — still mixable, but a smooth same-tempo blend
    /// is always preferred when available.
    public static BpmScore Score(decimal seedBpm, decimal candidateBpm)
    {
        var dSame = Math.Abs(seedBpm - candidateBpm);
        var dHalf = Math.Abs(seedBpm - candidateBpm * 2m);
        var dDouble = Math.Abs(seedBpm - candidateBpm / 2m);

        BpmRelation rel;
        decimal best;

        if (dSame <= dHalf && dSame <= dDouble)
        {
            rel = BpmRelation.Same;
            best = dSame;
        }
        else if (dHalf <= dDouble)
        {
            rel = BpmRelation.Half;
            best = dHalf;
        }
        else
        {
            rel = BpmRelation.Double;
            best = dDouble;
        }

        var points = best switch
        {
            <= 1m => 30,
            <= 2m => 25,
            <= 4m => 18,
            <= 6m => 10,
            _ => 0,
        };

        if (rel != BpmRelation.Same)
            points = (int)Math.Round(points * 0.85);

        return new BpmScore(points, rel, best);
    }
}
