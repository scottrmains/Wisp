using System.Text.Json;
using System.Text.Json.Serialization;
using Wisp.Infrastructure;

namespace Wisp.Api.Settings;

public sealed record WispSettings
{
    public string? LastFolder { get; init; }
    public WindowState? Window { get; init; }
    public RecommendationWeights? RecommendationWeights { get; init; }
    public CatalogCredentials? Catalog { get; init; }
}

public sealed record WindowState(int Width, int Height, int? X, int? Y);

public sealed record RecommendationWeights(double Key, double Bpm, double Energy, double Genre);

public sealed record CatalogCredentials
{
    public SpotifyCredentials? Spotify { get; init; }
    public DiscogsCredentials? Discogs { get; init; }
    public YouTubeCredentials? YouTube { get; init; }
}

public sealed record SpotifyCredentials(string ClientId, string ClientSecret);
public sealed record DiscogsCredentials(string PersonalAccessToken);
public sealed record YouTubeCredentials(string ApiKey);

public sealed class WispSettingsStore
{
    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly Lock _lock = new();
    private WispSettings _current;

    public WispSettingsStore()
    {
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
            _current = mutate(_current);
            Save(_current);
        }
    }

    private static WispSettings Load()
    {
        if (!File.Exists(WispPaths.ConfigPath))
            return new WispSettings();

        try
        {
            var json = File.ReadAllText(WispPaths.ConfigPath);
            return JsonSerializer.Deserialize<WispSettings>(json, Json) ?? new WispSettings();
        }
        catch
        {
            return new WispSettings();
        }
    }

    private static void Save(WispSettings settings)
    {
        var tmp = WispPaths.ConfigPath + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(settings, Json));
        File.Move(tmp, WispPaths.ConfigPath, overwrite: true);
    }
}
