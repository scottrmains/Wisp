using System.Globalization;
using System.Text;

namespace Wisp.Infrastructure.ArtistRefresh;

public static class TitleOverlap
{
    /// Normalizes a release title for "do I already have this?" comparison.
    /// Strips bracketed content (mix names, year tags, "(Remastered)"), punctuation,
    /// fold accents, lowercase, collapse whitespace.
    public static string Normalize(string title)
    {
        if (string.IsNullOrWhiteSpace(title)) return "";

        var sb = new StringBuilder(title.Length);
        var depth = 0;
        foreach (var c in title)
        {
            if (c is '(' or '[' or '{') { depth++; continue; }
            if (c is ')' or ']' or '}') { if (depth > 0) depth--; continue; }
            if (depth > 0) continue;

            if (char.IsLetterOrDigit(c) || char.IsWhiteSpace(c))
                sb.Append(c);
            else
                sb.Append(' ');
        }

        var stripped = sb.ToString().ToLowerInvariant().Trim();

        // Fold accents: "café" → "cafe"
        var formD = stripped.Normalize(NormalizationForm.FormD);
        var asciiSb = new StringBuilder(formD.Length);
        foreach (var c in formD)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
                asciiSb.Append(c);
        }

        return string.Join(' ', asciiSb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }
}
