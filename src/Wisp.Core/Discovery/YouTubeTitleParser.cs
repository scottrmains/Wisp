using System.Text.RegularExpressions;

namespace Wisp.Core.Discovery;

public sealed record ParsedYouTubeTitle(
    string? Artist,
    string? Title,
    string? Version,
    int? Year,
    bool IsLowConfidence);

/// Parse a YouTube video title into structured fields.
///
/// Different from FilenameParser:
///   - YouTube titles often have channel/uploader prefixes ("RokTorkar - Artist - Title")
///   - Different junk vocabulary: "[NEW]", "[Premiere]", "(Free DL)", "subscribe!", "out now",
///     "[CHANNEL_NAME]", "Sub for more", emoji clutter
///   - Some titles use ":" or "—" instead of "-"
///   - Year often shown as "[1994]" or just "1994"
public static class YouTubeTitleParser
{
    private static readonly Regex YearTag = new(@"\b(?<y>19[5-9]\d|20\d{2})\b", RegexOptions.Compiled);

    private static readonly Regex BracketContent = new(@"\(([^)]+)\)|\[([^\]]+)\]", RegexOptions.Compiled);

    /// Tokens we want to nuke wherever we find them.
    private static readonly Regex JunkTokens = new(
        @"\b(?:" +
        @"premiere|new|exclusive|out\s*now|out\s*today|free\s*(?:dl|download)|free\s*tune|" +
        @"hq|hd|320\s*kbps?|256\s*kbps?|192\s*kbps?|128\s*kbps?|" +
        @"full\s*track|full\s*song|full\s*version|" +
        @"official\s*(?:audio|video|music\s*video|lyric\s*video|visualizer)|" +
        @"audio\s*only|lyric\s*video|music\s*video|" +
        @"sub(?:scribe)?\s*for\s*more|like\s*and\s*subscribe" +
        @")\b",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex MixHints = new(
        @"\b(mix|remix|edit|dub|vip|bootleg|extended|radio|club|original|instrumental|acapella|rework|version)\b",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// Em-dash, en-dash, or " - " all act as artist/title separators.
    private static readonly char[] DashChars = ['-', '–', '—', '‒'];

    public static ParsedYouTubeTitle Parse(string raw, string? channelTitle = null)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return new ParsedYouTubeTitle(null, null, null, null, IsLowConfidence: true);

        var work = raw.Trim();

        // Strip emojis (anything outside basic Latin + common punct).
        work = StripDecorativeChars(work);

        // Pull year out, anywhere in the string, then remove it from working text so the
        // artist/title segmentation doesn't pick it up as part of the title.
        int? year = null;
        if (YearTag.Match(work) is { Success: true } ym)
        {
            year = int.Parse(ym.Groups["y"].Value);
            work = work.Remove(ym.Index, ym.Length);
        }

        // Find a bracket that looks like a mix label, take it as the version.
        string? version = null;
        foreach (Match m in BracketContent.Matches(work))
        {
            var inner = (m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value).Trim();
            if (string.IsNullOrWhiteSpace(inner)) continue;
            if (JunkTokens.IsMatch(inner)) continue;
            if (version is null && MixHints.IsMatch(inner)) version = inner;
        }

        // Strip all bracketed content + junk tokens from the working string.
        var cleaned = BracketContent.Replace(work, " ");
        cleaned = JunkTokens.Replace(cleaned, " ");
        cleaned = CollapseWhitespace(cleaned).Trim(' ', '-', '–', '—', '_', '|');

        // Note: deliberately NOT stripping channel-title prefixes here. For Topic channels the
        // channel name IS the artist, so stripping eats the artist and leaves the title alone.
        // The "Channel | Artist - Title" pattern (where channel is a curator/label) is rarer and
        // harder to disambiguate without false positives — surface as low confidence and let the
        // user fix via ParseCorrectionForm.
        _ = channelTitle; // reserved for future use

        // Parse "Artist - Title" — try every dash-style separator.
        string? artist = null;
        string? title = null;

        var dashIndex = FindDashSeparator(cleaned);
        if (dashIndex > 0)
        {
            artist = cleaned[..dashIndex].Trim();
            title = cleaned[(dashIndex + 1)..].Trim().TrimStart('-', '–', '—', ' ');
            // If title starts with another separator (multi-dash), recurse one level.
            var titleDash = FindDashSeparator(title);
            if (titleDash > 0)
            {
                // Heuristic: if we have "A - B - C", treat as "A - B" being artist (e.g. "Skee Mask - 50 Euro to Break Boost")
                // unless the second segment is short (likely a track number/code).
                var firstSeg = title[..titleDash].Trim();
                var secondSeg = title[(titleDash + 1)..].Trim();
                if (firstSeg.Length > 2 && secondSeg.Length > 2 && artist!.Length < firstSeg.Length + 5)
                {
                    artist += " - " + firstSeg;
                    title = secondSeg;
                }
            }
        }
        else
        {
            // Look for ":" as a fallback separator
            var colonIdx = cleaned.IndexOf(':');
            if (colonIdx > 0)
            {
                artist = cleaned[..colonIdx].Trim();
                title = cleaned[(colonIdx + 1)..].Trim();
            }
            else
            {
                // Whole thing is the title; we have no artist.
                title = string.IsNullOrWhiteSpace(cleaned) ? null : cleaned;
            }
        }

        // Sanity: if title is just "ID" or super short, low confidence.
        var lowConfidence =
            string.IsNullOrEmpty(artist) ||
            string.IsNullOrEmpty(title) ||
            (title?.Length ?? 0) < 2 ||
            string.Equals(title, "id", StringComparison.OrdinalIgnoreCase);

        return new ParsedYouTubeTitle(
            Artist: NullIfEmpty(artist),
            Title: NullIfEmpty(title),
            Version: NullIfEmpty(version),
            Year: year,
            IsLowConfidence: lowConfidence);
    }

    private static int FindDashSeparator(string s)
    {
        // Look for " - ", " – ", " — " — surrounded by spaces so we don't split hyphenated words.
        for (var i = 1; i < s.Length - 1; i++)
        {
            if (s[i - 1] == ' ' && s[i + 1] == ' ' && Array.IndexOf(DashChars, s[i]) >= 0)
                return i;
        }
        return -1;
    }

    private static string StripDecorativeChars(string s)
    {
        var sb = new System.Text.StringBuilder(s.Length);
        foreach (var c in s)
        {
            // Keep printable ASCII + common Latin extended + spaces + punctuation we care about.
            if (c < 0x20) continue;
            if (c is >= '☀' and <= '➿') continue; // Symbols + dingbats
            if (c is >= '\uD800' and <= '\uDFFF') continue; // surrogates (emoji halves)
            if (c is >= '︀' and <= '️') continue; // variation selectors
            sb.Append(c);
        }
        return sb.ToString();
    }

    private static string CollapseWhitespace(string s) =>
        Regex.Replace(s, @"\s+", " ");

    private static string? NullIfEmpty(string? s) =>
        string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
