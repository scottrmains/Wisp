using System.Text.Json;
using System.Text.Json.Serialization;
using System.Security.Cryptography;
using Wisp.Infrastructure;

namespace Wisp.Api.Settings;

public sealed record WispSettings
{
    public string? LastFolder { get; init; }
    public WindowState? Window { get; init; }
    public RecommendationWeights? RecommendationWeights { get; init; }
    public CatalogCredentials? Catalog { get; init; }
    /// Optional override for the FFmpeg binary path used by Mp3Transcoder
    /// (Phase 23). When null, discovery falls back to a bundled
    /// `ffmpeg.exe` next to `Wisp.exe`, then PATH.
    public string? FfmpegPath { get; init; }
}

public sealed record WindowState(int Width, int Height, int? X, int? Y);

public sealed record RecommendationWeights(double Key, double Bpm, double Energy, double Genre);

public sealed record CatalogCredentials
{
    public SpotifyCredentials? Spotify { get; init; }
    public DiscogsCredentials? Discogs { get; init; }
    public YouTubeCredentials? YouTube { get; init; }
    public SoulseekCredentials? Soulseek { get; init; }
}

public sealed record SpotifyCredentials(string ClientId, string ClientSecret);
public sealed record DiscogsCredentials(string PersonalAccessToken);
public sealed record YouTubeCredentials(string ApiKey);
public sealed record SoulseekCredentials(
    string Url,
    string ApiKey,
    string? DownloadFolder = null,
    /// Soulseek network login. Required for slskd to log in to the P2P network at all.
    /// Used both by the bundled-slskd sidecar and surfaced read-only when migrating from
    /// an existing user-managed slskd config.
    string? Username = null,
    string? Password = null,
    /// When true, Wisp spawns + manages the bundled slskd.exe as a child process. When false,
    /// Wisp connects to whatever slskd the user runs separately (the original Phase 11 model).
    /// Defaults to true for fresh installs; the sidecar additionally probes port 5030 at startup
    /// and defers to an externally-running slskd if one is already listening.
    bool ManageSlskd = true);

public sealed class WispSettingsStore
{
    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly Lock _lock = new();
    private readonly string _configPath;
    private WispSettings _current;

    public WispSettingsStore() : this(WispPaths.ConfigPath) { }

    public WispSettingsStore(string configPath)
    {
        _configPath = Path.GetFullPath(configPath);
        _current = Load();
    }

    public WispSettings Current
    {
        get { lock (_lock) return _current; }
    }

    public void Update(Func<WispSettings, WispSettings> mutate)
    {
        lock (_lock)
        {
            var next = mutate(_current);
            Save(next);
            _current = next;
        }
    }

    private WispSettings Load()
    {
        if (!File.Exists(_configPath))
            return new WispSettings();

        try
        {
            var json = File.ReadAllText(_configPath);
            return UnprotectSecrets(JsonSerializer.Deserialize<WispSettings>(json, Json) ?? new WispSettings());
        }
        catch
        {
            return new WispSettings();
        }
    }

    private void Save(WispSettings settings)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_configPath)!);
        var tmp = _configPath + ".tmp";
        // This app is Windows-only. Persist sensitive API keys and credentials
        // encrypted for the current Windows user rather than as readable JSON.
        // Non-sensitive configuration remains plain JSON for straightforward
        // support and manual recovery.
        File.WriteAllText(tmp, JsonSerializer.Serialize(ProtectSecrets(settings), Json));
        File.Move(tmp, _configPath, overwrite: true);
    }

    private static WispSettings ProtectSecrets(WispSettings settings) => settings with
    {
        Catalog = settings.Catalog is { } catalog ? catalog with
        {
            Spotify = catalog.Spotify is { } spotify
                ? spotify with { ClientSecret = ProtectRequired(spotify.ClientSecret) } : null,
            Discogs = catalog.Discogs is { } discogs
                ? discogs with { PersonalAccessToken = ProtectRequired(discogs.PersonalAccessToken) } : null,
            YouTube = catalog.YouTube is { } youTube
                ? youTube with { ApiKey = ProtectRequired(youTube.ApiKey) } : null,
            Soulseek = catalog.Soulseek is { } soulseek
                ? soulseek with { ApiKey = ProtectRequired(soulseek.ApiKey), Password = ProtectOptional(soulseek.Password) } : null,
        } : null,
    };

    private static WispSettings UnprotectSecrets(WispSettings settings) => settings with
    {
        Catalog = settings.Catalog is { } catalog ? catalog with
        {
            Spotify = catalog.Spotify is { } spotify
                ? spotify with { ClientSecret = UnprotectRequired(spotify.ClientSecret) } : null,
            Discogs = catalog.Discogs is { } discogs
                ? discogs with { PersonalAccessToken = UnprotectRequired(discogs.PersonalAccessToken) } : null,
            YouTube = catalog.YouTube is { } youTube
                ? youTube with { ApiKey = UnprotectRequired(youTube.ApiKey) } : null,
            Soulseek = catalog.Soulseek is { } soulseek
                ? soulseek with { ApiKey = UnprotectRequired(soulseek.ApiKey), Password = UnprotectOptional(soulseek.Password) } : null,
        } : null,
    };

    private const string ProtectedPrefix = "dpapi:";

    private static string ProtectRequired(string value) => ProtectOptional(value) ?? string.Empty;

    private static string? ProtectOptional(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.StartsWith(ProtectedPrefix, StringComparison.Ordinal)) return value;
        if (!OperatingSystem.IsWindows()) return value;
        var bytes = ProtectedData.Protect(System.Text.Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser);
        return ProtectedPrefix + Convert.ToBase64String(bytes);
    }

    private static string UnprotectRequired(string value) => UnprotectOptional(value) ?? string.Empty;

    private static string? UnprotectOptional(string? value)
    {
        if (string.IsNullOrEmpty(value) || !value.StartsWith(ProtectedPrefix, StringComparison.Ordinal)) return value;
        if (!OperatingSystem.IsWindows()) return null;
        try
        {
            var bytes = Convert.FromBase64String(value[ProtectedPrefix.Length..]);
            return System.Text.Encoding.UTF8.GetString(ProtectedData.Unprotect(bytes, null, DataProtectionScope.CurrentUser));
        }
        catch (CryptographicException)
        {
            // A config copied from another Windows account cannot be decrypted.
            // Treat it as absent instead of accidentally sending cipher text to a service.
            return null;
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
