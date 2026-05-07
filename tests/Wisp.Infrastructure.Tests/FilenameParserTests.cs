using Wisp.Infrastructure.Tagging;
using Xunit;

namespace Wisp.Infrastructure.Tests;

public class FilenameParserTests
{
    [Fact]
    public void Parses_artist_title_version_year()
    {
        var p = FilenameParser.Parse("Kim English - Nite Life (Bump Classic Mix) 1994.mp3");

        Assert.Equal("Kim English", p.Artist);
        Assert.Equal("Nite Life", p.Title);
        Assert.Equal("Bump Classic Mix", p.Version);
        Assert.Equal(1994, p.Year);
        Assert.False(p.IsLowConfidence);
    }

    [Fact]
    public void Parses_artist_title_with_extended_mix()
    {
        var p = FilenameParser.Parse("Daft Punk - Around The World (Extended Mix).flac");

        Assert.Equal("Daft Punk", p.Artist);
        Assert.Equal("Around The World", p.Title);
        Assert.Equal("Extended Mix", p.Version);
        Assert.Null(p.Year);
    }

    [Fact]
    public void Strips_leading_track_number()
    {
        var p = FilenameParser.Parse("01. MK - Burning.mp3");

        Assert.Equal("MK", p.Artist);
        Assert.Equal("Burning", p.Title);
    }

    [Fact]
    public void Replaces_underscores_with_spaces()
    {
        var p = FilenameParser.Parse("Solomun_-_After_Eight.mp3");

        Assert.Equal("Solomun", p.Artist);
        Assert.Equal("After Eight", p.Title);
    }

    [Fact]
    public void Strips_junk_tokens_but_keeps_version()
    {
        var p = FilenameParser.Parse("Disclosure - F For You (Original Mix) [320kbps] [FREE DL].mp3");

        Assert.Equal("Disclosure", p.Artist);
        Assert.Equal("F For You", p.Title);
        Assert.Equal("Original Mix", p.Version);
    }

    [Fact]
    public void Marks_low_confidence_when_no_dash_separator()
    {
        var p = FilenameParser.Parse("Classic House 1998 Mixtape.mp3");

        Assert.True(p.IsLowConfidence);
        Assert.Null(p.Artist);
    }

    [Fact]
    public void Picks_up_year_within_brackets_or_loose()
    {
        var p1 = FilenameParser.Parse("Kerri Chandler - Bar A Thym 2002.mp3");
        var p2 = FilenameParser.Parse("Dennis Ferrer - Hey Hey 2010.flac");

        Assert.Equal(2002, p1.Year);
        Assert.Equal(2010, p2.Year);
    }
}
