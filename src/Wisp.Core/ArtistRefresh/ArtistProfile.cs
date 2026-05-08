namespace Wisp.Core.ArtistRefresh;

public class ArtistProfile
{
    public Guid Id { get; set; }

    /// Display name as it first appeared in the library (e.g. "MK", "Kerri Chandler").
    public string Name { get; set; } = "";

    /// Lower-cased + trimmed for de-dup. Two ways to spell the same artist
    /// ("Kerri Chandler" / "kerri chandler") map to the same profile.
    public string NormalizedName { get; set; } = "";

    public string? SpotifyArtistId { get; set; }
    public string? MusicBrainzArtistId { get; set; }
    public string? DiscogsArtistId { get; set; }

    public DateTime? LastCheckedAt { get; set; }
    public DateTime CreatedAt { get; set; }
}
