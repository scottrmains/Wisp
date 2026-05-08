namespace Wisp.Infrastructure.ArtistRefresh;

public static class ArtistNormalizer
{
    /// Normalizes an artist name for de-dup. Trim, lowercase, collapse whitespace.
    /// Strips trailing "feat. X" / "ft. X" / "featuring X" so "MK feat. Alana" and "MK"
    /// dedup to the same profile.
    public static string Normalize(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        var s = raw.Trim().ToLowerInvariant();

        // Strip "feat./ft./featuring X" (and anything after)
        var cuts = new[] { " feat. ", " feat ", " ft. ", " ft ", " featuring " };
        foreach (var cut in cuts)
        {
            var idx = s.IndexOf(cut, StringComparison.Ordinal);
            if (idx > 0) s = s[..idx].Trim();
        }

        return string.Join(' ', s.Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }
}
