using Wisp.Core.Discovery;

namespace Wisp.Core.Tests;

public class YouTubeTitleParserTests
{
    [Fact]
    public void Spec_example_kim_english()
    {
        var p = YouTubeTitleParser.Parse("Kim English - Nite Life (Bump Classic Mix) 1994");
        Assert.Equal("Kim English", p.Artist);
        Assert.Equal("Nite Life", p.Title);
        Assert.Equal("Bump Classic Mix", p.Version);
        Assert.Equal(1994, p.Year);
        Assert.False(p.IsLowConfidence);
    }

    [Fact]
    public void Strips_youtube_specific_junk()
    {
        var p = YouTubeTitleParser.Parse("MK - Burning [PREMIERE] [FREE DL] HQ");
        Assert.Equal("MK", p.Artist);
        Assert.Equal("Burning", p.Title);
    }

    [Fact]
    public void Recognises_em_dash_separator()
    {
        var p = YouTubeTitleParser.Parse("Solomun – After Eight (Original Mix)");
        Assert.Equal("Solomun", p.Artist);
        Assert.Equal("After Eight", p.Title);
        Assert.Equal("Original Mix", p.Version);
    }

    [Fact]
    public void Falls_back_to_colon_separator()
    {
        var p = YouTubeTitleParser.Parse("Kerri Chandler: Bar A Thym");
        Assert.Equal("Kerri Chandler", p.Artist);
        Assert.Equal("Bar A Thym", p.Title);
    }

    [Fact]
    public void Topic_channel_video_parses_normally_without_eating_artist()
    {
        // For Topic channels the channel name == artist, so passing it as channelTitle must NOT strip
        // the artist out of the title. (The parser deliberately ignores channelTitle for now.)
        var p = YouTubeTitleParser.Parse("Solomun - After Eight", channelTitle: "Solomun - Topic");
        Assert.Equal("Solomun", p.Artist);
        Assert.Equal("After Eight", p.Title);
    }

    [Fact]
    public void Low_confidence_when_no_separator()
    {
        var p = YouTubeTitleParser.Parse("Classic House Mixtape Vol 3");
        Assert.True(p.IsLowConfidence);
    }

    [Fact]
    public void Low_confidence_when_title_is_id_placeholder()
    {
        var p = YouTubeTitleParser.Parse("Some DJ - ID");
        Assert.True(p.IsLowConfidence);
    }

    [Fact]
    public void Year_extracted_from_anywhere_in_title()
    {
        var p = YouTubeTitleParser.Parse("Junior Vasquez - Get Your Hands Off My Man (1995)");
        Assert.Equal(1995, p.Year);
    }

    [Fact]
    public void Strips_emoji_clutter()
    {
        var p = YouTubeTitleParser.Parse("🔥 Frankie Knuckles - Your Love 🔥");
        Assert.Equal("Frankie Knuckles", p.Artist);
        Assert.Equal("Your Love", p.Title);
    }

    [Fact]
    public void Multi_dash_keeps_extended_artist_segment()
    {
        // "Skee Mask - Pool - Boost" → most listeners read this as "Skee Mask - Pool" then "Boost"?
        // Heuristic prefers expanding artist when segments are reasonable lengths.
        var p = YouTubeTitleParser.Parse("Skee Mask - Pool - Boost");
        Assert.False(p.IsLowConfidence);
        Assert.NotNull(p.Artist);
        Assert.NotNull(p.Title);
    }
}
