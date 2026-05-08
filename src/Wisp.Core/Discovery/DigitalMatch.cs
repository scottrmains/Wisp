namespace Wisp.Core.Discovery;

public enum MatchAvailability
{
    Unknown,
    /// Streaming-only (e.g. Spotify catalog, no purchase).
    StreamingOnly,
    /// Digital purchase available (Discogs digital, Bandcamp, Beatport).
    DigitalPurchase,
    /// Physical-only (vinyl, CD) — no digital path.
    PhysicalOnly,
    /// Match exists but no longer available for purchase.
    Unavailable,
    /// Search-link fallback — we built a deep search URL but didn't query an API.
    SearchLink,
}

public class DigitalMatch
{
    public Guid Id { get; set; }
    public Guid DiscoveredTrackId { get; set; }

    /// "Discogs" | "MusicBrainz" | "Traxsource" | "Juno" | "Beatport" | "Bandcamp" | "Spotify"
    public string Source { get; set; } = "";
    public string ExternalId { get; set; } = "";
    public string Url { get; set; } = "";

    public string Artist { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Version { get; set; }
    public string? Label { get; set; }
    public int? Year { get; set; }

    public MatchAvailability Availability { get; set; }
    public int ConfidenceScore { get; set; }

    public DateTime MatchedAt { get; set; }

    public DiscoveredTrack? DiscoveredTrack { get; set; }
}
