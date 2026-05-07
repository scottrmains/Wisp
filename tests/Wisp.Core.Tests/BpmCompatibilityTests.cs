using Wisp.Core.Music;

namespace Wisp.Core.Tests;

public class BpmCompatibilityTests
{
    [Theory]
    [InlineData(126.0, 126.0, 30)]   // exact
    [InlineData(126.0, 126.5, 30)]   // <= 1
    [InlineData(126.0, 127.0, 30)]   // boundary
    [InlineData(126.0, 128.0, 25)]   // <= 2
    [InlineData(126.0, 130.0, 18)]   // <= 4
    [InlineData(126.0, 132.0, 10)]   // <= 6
    [InlineData(126.0, 140.0, 0)]    // > 6
    public void Same_tempo_score_bands(double seed, double cand, int expected)
    {
        var s = BpmCompatibility.Score((decimal)seed, (decimal)cand);
        Assert.Equal(expected, s.Points);
        Assert.Equal(BpmRelation.Same, s.Relation);
    }

    [Fact]
    public void Half_time_match_picks_half_relation_with_penalty()
    {
        // 126 vs 63 → effective distance 0, but Half relation → 30 * 0.85 = 25-26
        var s = BpmCompatibility.Score(126m, 63m);
        Assert.Equal(BpmRelation.Half, s.Relation);
        Assert.True(s.Points is >= 24 and <= 26, $"expected ~25, got {s.Points}");
    }

    [Fact]
    public void Double_time_match_picks_double_relation()
    {
        // 126 vs 252 → candidate at "double", effective distance via candidate/2 = 0
        var s = BpmCompatibility.Score(126m, 252m);
        Assert.Equal(BpmRelation.Double, s.Relation);
        Assert.True(s.Points > 0);
    }

    [Fact]
    public void Prefers_same_tempo_over_half_when_both_close()
    {
        // 126 vs 124 — same-tempo wins (diff 2) over half-time (124*2=248 vs 126 = 122)
        var s = BpmCompatibility.Score(126m, 124m);
        Assert.Equal(BpmRelation.Same, s.Relation);
    }

    [Fact]
    public void Far_apart_returns_zero()
    {
        var s = BpmCompatibility.Score(120m, 175m);
        Assert.Equal(0, s.Points);
    }
}
