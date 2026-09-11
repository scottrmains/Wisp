using System.Text.RegularExpressions;

namespace Wisp.Infrastructure.ExternalCatalog.YouTube;

public static class YouTubeSearchQuery
{
    // Artist - Title is ordinary music notation, not YouTube's NOT operator.
    // Preserve hyphens inside names (AC-DC) and intentional -word operators.
    public static string Normalize(string query) => Regex.Replace(
        Regex.Replace(query.Trim(), @"(?<=\s)[-–—](?=\s)", " "), @"\s+", " ");

    public static string? VideoId(string query)
    {
        var input = query.Trim();
        if (!input.Contains("://", StringComparison.Ordinal)) input = "https://" + input;
        if (!Uri.TryCreate(input, UriKind.Absolute, out var uri) ||
            uri.Scheme is not ("https" or "http")) return null;
        var host = uri.Host.ToLowerInvariant();
        string? id = null;
        var segments = uri.AbsolutePath.Trim('/').Split('/');
        if (host is "youtu.be" or "www.youtu.be") id = segments.FirstOrDefault();
        else if (host is "youtube.com" or "www.youtube.com" or "m.youtube.com" or "music.youtube.com")
        {
            if (uri.AbsolutePath == "/watch")
                id = uri.Query.TrimStart('?').Split('&').Select(p => p.Split('=', 2))
                    .Where(p => p.Length == 2 && p[0] == "v").Select(p => Uri.UnescapeDataString(p[1])).FirstOrDefault();
            else if (segments.Length == 2 && segments[0] is "shorts" or "embed" or "live") id = segments[1];
        }
        return id is not null && Regex.IsMatch(id, @"\A[A-Za-z0-9_-]{11}\z") ? id : null;
    }
}
