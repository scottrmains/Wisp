namespace Wisp.Core.Discovery;

public enum DiscoveryStatus
{
    /// Just imported, no user action yet.
    New,
    /// User flagged as wanted.
    Want,
    /// Already in user's library (set by LocalLibraryMatcher OR user).
    AlreadyHave,
    /// User dismissed.
    Ignore,
    /// No usable digital match found.
    NoMatch,
    /// Match found on a vinyl-only release (no digital purchase available).
    VinylOnly,
    /// Match found with a digital purchase option.
    DigitalAvailable,
    /// Possible matches exist but confidence is below "strong" threshold.
    PossibleMatch,
}

public class DiscoveredTrack
{
    public Guid Id { get; set; }
    public Guid DiscoverySourceId { get; set; }

    public string SourceVideoId { get; set; } = "";
    public string SourceUrl { get; set; } = "";

    public string RawTitle { get; set; } = "";
    public string? Description { get; set; }
    public string? ThumbnailUrl { get; set; }

    /// Parsed metadata from RawTitle. Null when low-confidence parse — user can override
    /// via ParseCorrectionForm.
    public string? ParsedArtist { get; set; }
    public string? ParsedTitle { get; set; }
    public string? MixVersion { get; set; }
    public int? ReleaseYear { get; set; }

    public DiscoveryStatus Status { get; set; }

    /// Set by LocalLibraryMatcher; if true the user already owns it.
    public bool IsAlreadyInLibrary { get; set; }
    public Guid? MatchedLocalTrackId { get; set; }

    public DateTime ImportedAt { get; set; }
    public DateTime? LastMatchedAt { get; set; }

    public DiscoverySource? Source { get; set; }
}
