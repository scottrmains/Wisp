namespace Wisp.Infrastructure.ExternalCatalog.Soulseek;

public sealed class SoulseekOptions
{
    /// Base URL of the user's slskd daemon (e.g. "http://localhost:5030").
    public string? Url { get; set; }

    /// API key configured in slskd.yml under `web.authentication.api_keys`.
    public string? ApiKey { get; set; }

    /// Optional. Path slskd is configured to download into. When set, Wisp triggers
    /// a library re-scan of this folder when a transfer completes — so newly
    /// downloaded files appear in the library automatically.
    public string? DownloadFolder { get; set; }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(Url) && !string.IsNullOrWhiteSpace(ApiKey);
}
