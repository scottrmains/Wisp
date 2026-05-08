namespace Wisp.Infrastructure.ExternalCatalog.Discogs;

public sealed class DiscogsOptions
{
    public string? PersonalAccessToken { get; set; }

    /// Polite UA per Discogs API guidance: "AppName/Version +contact-or-url"
    public string UserAgent { get; set; } = "Wisp/0.10 (+https://github.com/local/wisp)";

    public bool IsConfigured => !string.IsNullOrWhiteSpace(PersonalAccessToken);
}
