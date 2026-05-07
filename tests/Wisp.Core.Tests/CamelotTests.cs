using Wisp.Core.Music;

namespace Wisp.Core.Tests;

public class CamelotTests
{
    [Theory]
    [InlineData("8A", 8, false)]
    [InlineData("12B", 12, true)]
    [InlineData("1a", 1, false)]
    [InlineData("  3B  ", 3, true)]
    public void Parse_valid_codes(string input, int n, bool isMajor)
    {
        var c = Camelot.Parse(input);
        Assert.Equal(n, c.Number);
        Assert.Equal(isMajor, c.IsMajor);
    }

    [Theory]
    [InlineData("0A")]
    [InlineData("13B")]
    [InlineData("8C")]
    [InlineData("AA")]
    [InlineData("")]
    [InlineData(null)]
    public void TryParse_rejects_garbage(string? input)
    {
        Assert.False(Camelot.TryParse(input, out _));
    }

    [Fact]
    public void Same_key_relation()
    {
        Assert.Equal(KeyRelation.SameKey, Camelot.Parse("8A").RelationTo(Camelot.Parse("8A")));
    }

    [Fact]
    public void Adjacent_relation_both_directions()
    {
        Assert.Equal(KeyRelation.Adjacent, Camelot.Parse("8A").RelationTo(Camelot.Parse("9A")));
        Assert.Equal(KeyRelation.Adjacent, Camelot.Parse("8A").RelationTo(Camelot.Parse("7A")));
    }

    [Fact]
    public void Adjacent_wraps_around_wheel()
    {
        // 12A → 1A is adjacent on the circle
        Assert.Equal(KeyRelation.Adjacent, Camelot.Parse("12A").RelationTo(Camelot.Parse("1A")));
        Assert.Equal(KeyRelation.Adjacent, Camelot.Parse("1A").RelationTo(Camelot.Parse("12A")));
    }

    [Fact]
    public void Relative_major_minor_relation()
    {
        Assert.Equal(KeyRelation.RelativeMajorMinor, Camelot.Parse("8A").RelationTo(Camelot.Parse("8B")));
    }

    [Fact]
    public void Creative_includes_two_apart_same_letter()
    {
        Assert.Equal(KeyRelation.Creative, Camelot.Parse("8A").RelationTo(Camelot.Parse("10A")));
        Assert.Equal(KeyRelation.Creative, Camelot.Parse("8A").RelationTo(Camelot.Parse("6A")));
    }

    [Fact]
    public void Distant_when_far_apart()
    {
        Assert.Equal(KeyRelation.Distant, Camelot.Parse("8A").RelationTo(Camelot.Parse("2A")));
        Assert.Equal(KeyRelation.Distant, Camelot.Parse("1A").RelationTo(Camelot.Parse("7B")));
    }

    [Fact]
    public void Adjacent_returns_two_neighbours()
    {
        var n = Camelot.Parse("8A").Adjacent.ToList();
        Assert.Equal(2, n.Count);
        Assert.Contains(Camelot.Parse("9A"), n);
        Assert.Contains(Camelot.Parse("7A"), n);
    }

    [Fact]
    public void RelativeMajorMinor_flips_letter_keeps_number()
    {
        Assert.Equal(Camelot.Parse("8B"), Camelot.Parse("8A").RelativeMajorMinor);
        Assert.Equal(Camelot.Parse("3A"), Camelot.Parse("3B").RelativeMajorMinor);
    }
}
