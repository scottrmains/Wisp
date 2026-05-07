using System.Globalization;
using System.Text.RegularExpressions;

namespace Wisp.Core.Cleanup;

public static class NameNormalizer
{
    // ─────────────────────────────────────────────────────────────────────────
    // Junk stripping
    // ─────────────────────────────────────────────────────────────────────────

    private static readonly Regex BitrateTag = new(
        @"\b(?:128|192|224|256|320)\s*kbps?\b",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex FreeDownload = new(
        @"\[?\s*free\s*(?:dl|download)\s*\]?",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex CopySuffix = new(
        @"\s*[\(\[]copy[\)\]]|\s*-\s*copy\s*$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex DuplicateSuffix = new(
        @"\s*\(\d+\)\s*$",
        RegexOptions.Compiled);

    private static readonly Regex FinalSuffix = new(
        @"\s*[\(\[]final[\)\]]|\s+-\s+final\s*$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex CollapseSpace = new(@"\s+", RegexOptions.Compiled);
    private static readonly Regex TrailingDelims = new(@"[\s\-_]+$", RegexOptions.Compiled);
    private static readonly Regex LeadingDelims = new(@"^[\s\-_]+", RegexOptions.Compiled);

    public static string StripJunk(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return input ?? "";
        var s = input;

        s = BitrateTag.Replace(s, " ");
        s = FreeDownload.Replace(s, " ");
        s = CopySuffix.Replace(s, " ");
        s = DuplicateSuffix.Replace(s, " ");
        s = FinalSuffix.Replace(s, " ");

        s = CollapseSpace.Replace(s, " ");
        s = TrailingDelims.Replace(s, "");
        s = LeadingDelims.Replace(s, "");
        return s.Trim();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Title casing
    // ─────────────────────────────────────────────────────────────────────────

    private static readonly HashSet<string> SmallWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "a", "an", "the", "of", "in", "on", "at", "to", "for", "and", "or", "but", "by", "with", "from", "as", "vs",
    };

    /// All-caps tokens that should never get title-cased (DJ → Dj is wrong).
    private static readonly HashSet<string> KeepUpper = new(StringComparer.OrdinalIgnoreCase)
    {
        "VIP", "MK", "DJ", "EP", "LP", "ID", "USA", "UK", "EU", "NYC", "BPM", "FM", "AM", "IDM", "DnB", "UFO",
    };

    /// Lowercase tokens that should stay lowercase.
    private static readonly HashSet<string> KeepLower = new(StringComparer.OrdinalIgnoreCase)
    {
        "feat.", "feat", "ft.", "ft", "vs.", "pres.", "pres", "aka",
    };

    private static readonly Regex WordSplit = new(@"(\s+|[\-_/])", RegexOptions.Compiled);

    public static string TitleCase(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return input ?? "";

        var parts = WordSplit.Split(input);

        // Detect typed-in-caps input ("FATBOY SLIM", "THE MAN OF THE HOUR"): 2+ word tokens,
        // every word entirely uppercase. In that case lowercase the whole thing before per-word
        // logic kicks in — otherwise every word looks like an all-caps acronym to preserve.
        // Single all-caps tokens like "MGMT" (alone or in "MGMT - Kids") still get preserved.
        var wordTokens = parts.Where(IsWord).ToArray();
        if (wordTokens.Length >= 2 && wordTokens.All(w => !w.Any(char.IsLower)))
        {
            input = input.ToLowerInvariant();
            parts = WordSplit.Split(input);
        }
        var firstWordIdx = -1;
        var lastWordIdx = -1;
        for (var i = 0; i < parts.Length; i++)
        {
            if (IsWord(parts[i]))
            {
                if (firstWordIdx < 0) firstWordIdx = i;
                lastWordIdx = i;
            }
        }

        for (var i = 0; i < parts.Length; i++)
        {
            if (!IsWord(parts[i])) continue;
            parts[i] = CaseWord(parts[i], isFirstOrLast: i == firstWordIdx || i == lastWordIdx);
        }

        return string.Concat(parts);
    }

    private static bool IsWord(string token) => token.Length > 0 && !WordSplit.IsMatch(token);

    private static string CaseWord(string word, bool isFirstOrLast)
    {
        // Preserve known mixed-case identities first.
        if (KeepUpper.Contains(word)) return word.ToUpperInvariant();
        if (KeepLower.Contains(word)) return word.ToLowerInvariant();

        // Preserve intentional mixed case ("deadmau5", "MGMT", "WhoMadeWho").
        if (HasMeaningfulMixedCase(word)) return word;

        if (!isFirstOrLast && SmallWords.Contains(word)) return word.ToLowerInvariant();

        // Brackets/quotes wrapping a single word: "(extended mix)" → "(Extended Mix)" handled at the split level
        return char.ToUpperInvariant(word[0]) + (word.Length > 1 ? word[1..].ToLowerInvariant() : "");
    }

    private static bool HasMeaningfulMixedCase(string word)
    {
        if (word.Length < 3) return false;

        // Looks like all-caps acronym with at least 2 letters (e.g. "MGMT")
        if (word.All(c => char.IsUpper(c) || char.IsDigit(c))) return word.Count(char.IsUpper) >= 2;

        // Mixed in middle (e.g. "deadmau5", "WhoMadeWho", "iLoveMakonnen")
        var hasInternalUpper = word.Skip(1).Any(char.IsUpper);
        var hasDigit = word.Any(char.IsDigit);
        return hasInternalUpper || (hasDigit && char.IsLower(word[0]));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Version extraction
    // ─────────────────────────────────────────────────────────────────────────

    private static readonly Regex VersionInTitle = new(
        @"^(?<title>.+?)\s*[\(\[](?<version>[^()\[\]]*?(?:Mix|Remix|Edit|Dub|VIP|Bootleg|Rework|Version|Instrumental|Acapella)[^()\[\]]*?)[\)\]]\s*$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// Returns (cleanedTitle, extractedVersion) if the title looks like
    /// "Something (Extended Mix)" — otherwise (title, null).
    public static (string Title, string? Version) ExtractVersion(string title)
    {
        if (string.IsNullOrWhiteSpace(title)) return (title ?? "", null);
        var m = VersionInTitle.Match(title.Trim());
        if (!m.Success) return (title.Trim(), null);

        var t = m.Groups["title"].Value.Trim();
        var v = m.Groups["version"].Value.Trim();
        return (t, v);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Filename construction
    // ─────────────────────────────────────────────────────────────────────────

    private static readonly char[] InvalidFsChars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

    public static string SanitizeForFilesystem(string input)
    {
        if (string.IsNullOrEmpty(input)) return input ?? "";
        var chars = input.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            if (Array.IndexOf(InvalidFsChars, chars[i]) >= 0 || char.IsControl(chars[i]))
                chars[i] = '_';
        }
        var s = new string(chars).Trim();
        // Trailing dots/spaces are illegal on Windows.
        s = s.TrimEnd('.', ' ');
        return s;
    }

    /// Build "Artist - Title (Version).ext" with sanitization. All inputs must already be cleaned/cased.
    public static string BuildFileName(string? artist, string? title, string? version, string extension)
    {
        var name = string.IsNullOrWhiteSpace(artist)
            ? (title ?? "Untitled")
            : $"{artist} - {title}";

        if (!string.IsNullOrWhiteSpace(version)) name += $" ({version})";
        return SanitizeForFilesystem(name) + extension;
    }
}

internal static class StringExtensions
{
    public static string ToTitleCaseInvariant(this string s)
        => CultureInfo.InvariantCulture.TextInfo.ToTitleCase(s.ToLowerInvariant());
}
