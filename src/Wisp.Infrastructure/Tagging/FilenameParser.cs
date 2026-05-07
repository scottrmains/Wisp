using System.Text.RegularExpressions;

namespace Wisp.Infrastructure.Tagging;

public sealed record ParsedFilename(string? Artist, string? Title, string? Version, int? Year, bool IsLowConfidence);

/// Parses common DJ-pool filename patterns like:
///   "Kim English - Nite Life (Bump Classic Mix) [Label] 1994.mp3"
///   "Artist - Title (Original Mix).flac"
///   "01. Artist - Title.mp3"
///   "Artist_-_Title.mp3"
public static class FilenameParser
{
    private static readonly Regex LeadingTrackNo = new(@"^\s*\d{1,3}[\.\)\-]\s*", RegexOptions.Compiled);
    private static readonly Regex JunkTokens = new(
        @"\b(320\s*kbps|256\s*kbps|192\s*kbps|HQ|FREE\s*DL|FREE\s*DOWNLOAD|FULL\s*VERSION|copy|final|remaster(ed)?)\b",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex BracketContent = new(@"\(([^)]+)\)|\[([^\]]+)\]", RegexOptions.Compiled);
    private static readonly Regex YearPattern = new(@"\b(19[5-9]\d|20\d{2})\b", RegexOptions.Compiled);
    private static readonly string[] VersionHints =
    [
        "mix", "remix", "edit", "dub", "vip", "bootleg", "extended", "radio", "instrumental", "acapella", "rework"
    ];

    public static ParsedFilename Parse(string filename)
    {
        var name = Path.GetFileNameWithoutExtension(filename) ?? "";
        name = name.Replace('_', ' ').Trim();
        name = LeadingTrackNo.Replace(name, "");

        int? year = null;
        var yearMatch = YearPattern.Match(name);
        if (yearMatch.Success)
        {
            year = int.Parse(yearMatch.Value);
            name = name.Remove(yearMatch.Index, yearMatch.Length).Trim();
        }

        string? version = null;
        var bracketMatches = BracketContent.Matches(name);
        foreach (Match m in bracketMatches)
        {
            var inner = (m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value).Trim();
            if (string.IsNullOrWhiteSpace(inner)) continue;

            // Skip junk-only brackets.
            if (JunkTokens.IsMatch(inner)) continue;

            // First bracket that looks like a mix/version wins.
            if (version is null && VersionHints.Any(h =>
                    inner.Contains(h, StringComparison.OrdinalIgnoreCase)))
            {
                version = inner;
            }
        }

        // Strip all bracket content + junk tokens from the working name to clean artist/title.
        var stripped = BracketContent.Replace(name, " ");
        stripped = JunkTokens.Replace(stripped, " ");
        stripped = Regex.Replace(stripped, @"\s+", " ").Trim(' ', '-', '_');

        string? artist = null;
        string? title = null;
        var dashIndex = stripped.IndexOf(" - ", StringComparison.Ordinal);
        if (dashIndex > 0)
        {
            artist = stripped[..dashIndex].Trim();
            title = stripped[(dashIndex + 3)..].Trim();
        }
        else
        {
            title = string.IsNullOrWhiteSpace(stripped) ? null : stripped;
        }

        var lowConfidence =
            string.IsNullOrEmpty(artist) ||
            string.IsNullOrEmpty(title) ||
            (title?.Length ?? 0) < 2;

        return new ParsedFilename(artist, title, version, year, lowConfidence);
    }
}
