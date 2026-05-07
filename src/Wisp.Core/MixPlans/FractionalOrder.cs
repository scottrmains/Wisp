namespace Wisp.Core.MixPlans;

/// Compute order values for inserting/moving rows without renumbering siblings.
/// Strategy: midpoint between the orders of the two neighbouring rows.
/// Pure double precision is good for ~50 nested midpoint inserts in the same gap
/// before precision collapses; in normal use that's vastly more than enough.
public static class FractionalOrder
{
    public const double DefaultStep = 1024;

    public static double Between(double? before, double? after)
    {
        if (before is null && after is null) return DefaultStep;
        if (before is null) return after!.Value - DefaultStep;
        if (after is null) return before.Value + DefaultStep;

        var midpoint = (before.Value + after.Value) / 2.0;

        // Detect precision collapse: midpoint must lie strictly between the two.
        // If it doesn't, the caller should rebalance by re-spreading the whole list.
        if (midpoint <= before.Value || midpoint >= after.Value)
            throw new InvalidOperationException(
                "Fractional order has collapsed; rebalance the sequence.");

        return midpoint;
    }
}
