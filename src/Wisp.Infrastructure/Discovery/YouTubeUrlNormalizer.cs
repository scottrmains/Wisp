using System.Text.RegularExpressions;

namespace Wisp.Infrastructure.Discovery;

public enum YouTubeUrlKind { Channel, Playlist, Handle, Username, Custom }

/// Parsed result of a YouTube URL — what to look up against the API to resolve to a canonical id.
public sealed record YouTubeUrlTarget(YouTubeUrlKind Kind, string Value);

public static class YouTubeUrlNormalizer
{
    private static readonly Regex ChannelId = new(@"youtube\.com/channel/(?<id>UC[\w-]{20,})", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PlaylistId = new(@"[?&]list=(?<id>[\w-]+)", RegexOptions.Compiled);
    private static readonly Regex Handle = new(@"youtube\.com/@(?<h>[\w.-]+)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Username = new(@"youtube\.com/user/(?<u>[\w-]+)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Custom = new(@"youtube\.com/c/(?<c>[\w.-]+)", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// Tries to extract the most-specific identifier from a YouTube URL or pasted handle.
    public static YouTubeUrlTarget? Parse(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var s = raw.Trim();

        // Bare @handle, no protocol
        if (s.StartsWith('@') && s.Length > 1)
            return new YouTubeUrlTarget(YouTubeUrlKind.Handle, s.TrimStart('@'));

        // Bare channel id, no protocol
        if (s.StartsWith("UC", StringComparison.Ordinal) && s.Length >= 22 && s.All(c => char.IsLetterOrDigit(c) || c is '_' or '-'))
            return new YouTubeUrlTarget(YouTubeUrlKind.Channel, s);

        if (PlaylistId.Match(s) is { Success: true } pl)
            return new YouTubeUrlTarget(YouTubeUrlKind.Playlist, pl.Groups["id"].Value);

        if (ChannelId.Match(s) is { Success: true } ch)
            return new YouTubeUrlTarget(YouTubeUrlKind.Channel, ch.Groups["id"].Value);

        if (Handle.Match(s) is { Success: true } h)
            return new YouTubeUrlTarget(YouTubeUrlKind.Handle, h.Groups["h"].Value);

        if (Username.Match(s) is { Success: true } un)
            return new YouTubeUrlTarget(YouTubeUrlKind.Username, un.Groups["u"].Value);

        if (Custom.Match(s) is { Success: true } cu)
            return new YouTubeUrlTarget(YouTubeUrlKind.Custom, cu.Groups["c"].Value);

        return null;
    }
}
