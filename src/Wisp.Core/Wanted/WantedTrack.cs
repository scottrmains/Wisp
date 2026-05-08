using Wisp.Core.Tracks;

namespace Wisp.Core.Wanted;

/// Where the want originated. Lets the UI render a source badge per row
/// without coupling to source-specific fields (a Crate Digger want has a
/// SourceVideoId; a Manual want might just be Artist + Title).
public enum WantedSource
{
    /// Marked Want from the Discover page (search hit, ad-hoc artist video).
    Discover,
    /// Marked Want on a row inside Crate Digger's curator-channel scans.
    CrateDigger,
    /// Hand-entered by the user with no source.
    Manual,
}

/// User wishlist entry — collects tracks the user wants to find from anywhere
/// in the app (Discover, Crate Digger, manual entry). Single source of truth
/// for the Wanted sidebar page; auto-flagged `MatchedLocalTrackId` when the
/// scanner finds a matching local track.
///
/// Crate Digger keeps `DiscoveredTrack` as its primary entity (bound to a
/// curator channel scan); a `Status = Want` write there also creates a
/// WantedTrack so the cross-feature wishlist stays unified.
public class WantedTrack
{
    public Guid Id { get; set; }
    public WantedSource Source { get; set; }

    /// Optional pointer back to a YouTube video this was wanted from.
    public string? SourceVideoId { get; set; }
    /// Optional canonical URL (Spotify track, YouTube watch link, Discogs
    /// release page, …) so the user can open the original.
    public string? SourceUrl { get; set; }

    /// Required — together they form the (case-insensitive) idempotency key
    /// for POST so the same artist + title can't be wanted twice.
    public string Artist { get; set; } = "";
    public string Title { get; set; } = "";

    /// Optional thumbnail cached from the source result so the Wanted page
    /// has artwork even if the original source goes 404.
    public string? ThumbnailUrl { get; set; }

    /// Free-form note ("vinyl-only edit", "from Rok's set 2019", etc.).
    public string? Notes { get; set; }

    /// Set by the library scan worker when a newly-imported Track matches
    /// (Artist, Title) via ArtistNormalizer + TitleOverlap normalization.
    /// Once set, the row gets a "✓ in library" chip — but stays in the list
    /// (not auto-deleted) so the user sees the success.
    public Guid? MatchedLocalTrackId { get; set; }
    public DateTime? MatchedAt { get; set; }

    public DateTime AddedAt { get; set; }

    public Track? MatchedLocalTrack { get; set; }
}
