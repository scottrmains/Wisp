using Wisp.Core.Cleanup;

namespace Wisp.Core.Tests;

public class NameNormalizerTests
{
    [Theory]
    [InlineData("My Track 320kbps", "My Track")]
    [InlineData("My Track [FREE DL]", "My Track")]
    [InlineData("My Track Free Download", "My Track")]
    [InlineData("My Track (copy)", "My Track")]
    [InlineData("My Track - Copy", "My Track")]
    [InlineData("My Track (1)", "My Track")]
    [InlineData("My Track (final)", "My Track")]
    [InlineData("  Trim  Me  ", "Trim Me")]
    public void Strips_common_junk_patterns(string input, string expected)
    {
        Assert.Equal(expected, NameNormalizer.StripJunk(input));
    }

    [Theory]
    [InlineData("VIP Mix")]                // version markers stay intact
    [InlineData("Burnin' (VIP)")]
    [InlineData("Solomun")]
    [InlineData("MK feat. Alana")]
    public void Strip_preserves_meaningful_text(string input)
    {
        Assert.Equal(input, NameNormalizer.StripJunk(input));
    }

    [Theory]
    [InlineData("kim english", "Kim English")]
    [InlineData("THE MAN OF THE HOUR", "The Man of the Hour")]
    [InlineData("dj mehdi vs the chemical brothers", "DJ Mehdi vs the Chemical Brothers")]
    [InlineData("nite life feat. somebody", "Nite Life feat. Somebody")]
    public void Title_case_handles_small_words_and_known_caps(string input, string expected)
    {
        Assert.Equal(expected, NameNormalizer.TitleCase(input));
    }

    [Theory]
    [InlineData("deadmau5")]
    [InlineData("MGMT")]
    [InlineData("WhoMadeWho")]
    public void Title_case_preserves_intentional_mixed_case(string input)
    {
        Assert.Equal(input, NameNormalizer.TitleCase(input));
    }

    [Fact]
    public void First_and_last_word_always_capitalised_even_if_small()
    {
        Assert.Equal("In Search Of", NameNormalizer.TitleCase("in search of"));
        Assert.Equal("And", NameNormalizer.TitleCase("and"));
    }

    [Fact]
    public void Extracts_version_from_bracketed_mix_name()
    {
        var (title, version) = NameNormalizer.ExtractVersion("Nite Life (Bump Classic Mix)");
        Assert.Equal("Nite Life", title);
        Assert.Equal("Bump Classic Mix", version);
    }

    [Fact]
    public void Extracts_version_from_square_brackets()
    {
        var (title, version) = NameNormalizer.ExtractVersion("Nite Life [Extended Mix]");
        Assert.Equal("Nite Life", title);
        Assert.Equal("Extended Mix", version);
    }

    [Fact]
    public void Returns_null_version_when_no_mix_marker()
    {
        var (title, version) = NameNormalizer.ExtractVersion("Just A Title");
        Assert.Equal("Just A Title", title);
        Assert.Null(version);
    }

    [Fact]
    public void BuildFileName_uses_artist_title_version_pattern()
    {
        var name = NameNormalizer.BuildFileName("Kim English", "Nite Life", "Bump Classic Mix", ".mp3");
        Assert.Equal("Kim English - Nite Life (Bump Classic Mix).mp3", name);
    }

    [Fact]
    public void BuildFileName_omits_version_when_absent()
    {
        Assert.Equal("MK - Burning.mp3", NameNormalizer.BuildFileName("MK", "Burning", null, ".mp3"));
    }

    [Theory]
    [InlineData("Bad: Name?", "Bad_ Name_.mp3")]
    [InlineData("Path/With\\Bad|Chars*", "Path_With_Bad_Chars_.mp3")]
    public void Sanitize_replaces_filesystem_reserved_chars(string title, string expected)
    {
        Assert.Equal(expected, NameNormalizer.BuildFileName(null, title, null, ".mp3"));
    }
}
