namespace Wisp.Core.Discovery;

public enum DiscoverySourceType
{
    YouTubeChannel,
    YouTubePlaylist,
}

public class DiscoverySource
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public DiscoverySourceType SourceType { get; set; }

    /// Original URL the user pasted (for display).
    public string SourceUrl { get; set; } = "";

    /// Resolved canonical YouTube id — channelId for channels, playlistId for playlists.
    /// Stable across channel renames (channel ids never change once assigned).
    public string ExternalSourceId { get; set; } = "";

    /// For channels we cache the uploads playlist id to skip a `channels.list` call on every rescan.
    public string? UploadsPlaylistId { get; set; }

    public DateTime AddedAt { get; set; }
    public DateTime? LastScannedAt { get; set; }

    public int ImportedCount { get; set; }
}
