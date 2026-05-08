namespace Wisp.Infrastructure.ExternalCatalog.Spotify;

public sealed class SpotifyOptions
{
    public string? ClientId { get; set; }
    public string? ClientSecret { get; set; }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);
}
