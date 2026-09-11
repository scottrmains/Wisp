namespace Wisp.Infrastructure.ExternalCatalog.Soulseek;

public sealed class SoulseekOptions
{
    /// Base URL of the user's slskd daemon (e.g. "http://localhost:5030").
    public string? Url { get; set; }

    /// API key configured in slskd.yml under `web.authentication.api_keys`.
    public string? ApiKey { get; set; }

    /// Saved destination for the next managed sidecar launch. Imports use the
    /// daemon's actual folder, which can differ until Wisp is restarted.
    public string? DownloadFolder { get; set; }
    /// Folder passed to the currently running Wisp-owned sidecar. Changes to the
    /// next-start preference must not redirect imports from in-flight downloads.
    public string? ActiveDownloadFolder { get; set; }

    /// Soulseek network credentials. Required by slskd to log in to the P2P network.
    /// When the bundled-slskd sidecar is in charge of the daemon, these are written
    /// into the generated slskd.yml each time it starts.
    public string? Username { get; set; }
    public string? Password { get; set; }

    /// True when Wisp owns the slskd lifecycle (spawns + manages it as a child process).
    /// False when the user runs slskd themselves — in which case the sidecar stays out.
    public bool ManageSlskd { get; set; } = true;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(Url) && !string.IsNullOrWhiteSpace(ApiKey);
}
