namespace Wisp.Core.ArtistRefresh;

public enum ReleaseType
{
    Album,
    Single,
    Ep,
    Remix,
    Compilation,
    AppearsOn,
    Unknown,
}

public class ExternalRelease
{
    public Guid Id { get; set; }
    public Guid ArtistProfileId { get; set; }

    /// "Spotify" | "MusicBrainz" | "Discogs"
    public string Source { get; set; } = "";
    public string ExternalId { get; set; } = "";

    public string Title { get; set; } = "";
    public ReleaseType ReleaseType { get; set; }
    public DateOnly? ReleaseDate { get; set; }

    public string? Url { get; set; }
    public string? ArtworkUrl { get; set; }

    public bool IsAlreadyInLibrary { get; set; }
    public Guid? MatchedLocalTrackId { get; set; }

    public bool IsDismissed { get; set; }
    public bool IsSavedForLater { get; set; }

    public DateTime FetchedAt { get; set; }

    public ArtistProfile? Artist { get; set; }
}
