using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace Wisp.Infrastructure.ExternalCatalog.Soulseek;

public sealed class SoulseekNotConfiguredException()
    : Exception("slskd URL + API key are not configured.");

public sealed class SoulseekUnreachableException(string message, Exception? inner = null)
    : Exception(message, inner);

public sealed class SoulseekClient(
    IHttpClientFactory httpFactory,
    SoulseekOptions options,
    ILogger<SoulseekClient> log)
{
    // log is reserved for future structured tracing — keep injected so DI shape stays uniform with the other clients.
    private readonly ILogger<SoulseekClient> _log = log;

    public bool IsConfigured => options.IsConfigured;

    // Do not persist URLs (which may contain credentials) in import receipts.
    public string SourceKey => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
        System.Text.Encoding.UTF8.GetBytes((options.Url ?? "").TrimEnd('/'))));

    public async Task<SoulseekConnection> GetConnectionAsync(CancellationToken ct)
    {
        if (!IsConfigured) return new(false, false, false, false, false, null, "Set up Soulseek in Settings.");
        try
        {
            var state = await RequestAsync<ServerStatus>(HttpMethod.Get, "server", null, ct);
            return new(true, true, state?.IsConnected ?? false, state?.IsLoggedIn ?? false,
                state?.IsTransitioning ?? false, state?.Username,
                state?.IsLoggedIn == true ? null : "Soulseek is not logged in. Check your login in Settings or reconnect.");
        }
        catch (Exception ex) when (ex is SoulseekUnreachableException or InvalidOperationException or System.Text.Json.JsonException)
        {
            return new(true, false, false, false, false, null, ex.Message);
        }
    }

    public Task ReconnectAsync(CancellationToken ct) => RequestAsync<object>(HttpMethod.Put, "server", null, ct);
    public Task StopSearchAsync(string id, CancellationToken ct) =>
        RequestAsync<object>(HttpMethod.Put, $"searches/{Uri.EscapeDataString(id)}", null, ct, allowMissing: true);
    public Task DeleteSearchAsync(string id, CancellationToken ct) =>
        RequestAsync<object>(HttpMethod.Delete, $"searches/{Uri.EscapeDataString(id)}", null, ct, allowMissing: true);
    public Task RescanSharesAsync(CancellationToken ct) => RequestAsync<object>(HttpMethod.Put, "shares", null, ct);

    public async Task<IReadOnlyList<SoulseekShare>> ListSharesAsync(CancellationToken ct)
    {
        var hosts = await RequestAsync<Dictionary<string, SoulseekShare[]>>(HttpMethod.Get, "shares", null, ct);
        return hosts?.Values.SelectMany(x => x).ToArray() ?? [];
    }

    public async Task<SoulseekShareScan?> GetShareScanAsync(CancellationToken ct) =>
        (await RequestAsync<ApplicationShares>(HttpMethod.Get, "application", null, ct))?.Shares;

    private async Task<T?> RequestAsync<T>(HttpMethod method, string path, object? body, CancellationToken ct, bool allowMissing = false)
    {
        if (!IsConfigured) throw new SoulseekNotConfiguredException();
        try
        {
            using var request = new HttpRequestMessage(method, Url(path));
            if (body is not null) request.Content = JsonContent.Create(body);
            using var response = await Client().SendAsync(request, ct);
            if (allowMissing && response.StatusCode == System.Net.HttpStatusCode.NotFound) return default;
            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException($"Soulseek operation failed (HTTP {(int)response.StatusCode}). Refresh or check your connection.");
            if (typeof(T) == typeof(object) || response.StatusCode == System.Net.HttpStatusCode.NoContent) return default;
            return await response.Content.ReadFromJsonAsync<T>(ct);
        }
        catch (HttpRequestException ex) { throw MapHttp(ex); }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested) { throw MapTimeout(ex); }
    }

    /// Probe `GET /api/v0/application` — cheap and always available.
    public async Task<string?> TestConnectionAsync(CancellationToken ct)
    {
        if (!options.IsConfigured) return "Not configured.";
        try
        {
            using var resp = await Client().GetAsync(Url("application"), ct);
            if (resp.IsSuccessStatusCode) return null;
            var body = await resp.Content.ReadAsStringAsync(ct);
            return $"slskd returned {(int)resp.StatusCode}. {Truncate(body, 200)}";
        }
        catch (HttpRequestException ex)
        {
            return $"Could not reach slskd at {options.Url}: {ex.Message}";
        }
        catch (Exception ex)
        {
            return ex.Message;
        }
    }

    /// When slskd isn't running, the HTTP attempt either:
    ///   * gets refused immediately (HttpRequestException — TCP RST), or
    ///   * hangs until the 3s HttpClient.Timeout fires (TaskCanceledException with an inner TimeoutException).
    /// Both modes mean "slskd is unavailable", so we map them to SoulseekUnreachableException for a clean
    /// 400 response rather than letting the request bubble up as a 500 / debugger break. The genuine
    /// "user cancelled" case is preserved by re-throwing when the caller's CT is the source.
    private static SoulseekUnreachableException MapTimeout(TaskCanceledException ex) =>
        new($"slskd did not respond within 3 seconds — is the daemon running?", ex);
    private static SoulseekUnreachableException MapHttp(HttpRequestException ex) =>
        new($"Could not reach slskd: {ex.Message}", ex);

    /// Kick off a search. Returns the search id slskd assigns. Caller polls `GetSearchAsync`
    /// until `IsComplete` or until they decide it's been long enough.
    public async Task<string> StartSearchAsync(string query, int fileLimit, CancellationToken ct)
    {
        if (!options.IsConfigured) throw new SoulseekNotConfiguredException();

        var id = Guid.NewGuid().ToString();
        var body = new { id, searchText = query, fileLimit };
        try
        {
            using var resp = await Client().PostAsJsonAsync(Url("searches"), body, ct);
            resp.EnsureSuccessStatusCode();
            return id;
        }
        catch (HttpRequestException ex) { throw MapHttp(ex); }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested) { throw MapTimeout(ex); }
    }

    public async Task<SoulseekSearchResult> GetSearchAsync(string searchId, CancellationToken ct)
    {
        if (!options.IsConfigured) throw new SoulseekNotConfiguredException();

        try
        {
            // 1. Status (state + isComplete)
            using var statusResp = await Client().GetAsync(Url($"searches/{Uri.EscapeDataString(searchId)}"), ct);
            statusResp.EnsureSuccessStatusCode();
            var status = await statusResp.Content.ReadFromJsonAsync<SearchStatus>(ct);
            if (status is null) return new SoulseekSearchResult(searchId, true, 0, []);

            // 2. Responses (per-user file lists)
            using var respResp = await Client().GetAsync(
                Url($"searches/{Uri.EscapeDataString(searchId)}/responses"), ct);
            respResp.EnsureSuccessStatusCode();
            var responses = await respResp.Content.ReadFromJsonAsync<SearchResponse[]>(ct) ?? [];

            var hits = responses
                .SelectMany(r => (r.Files ?? []).Select(f => Flatten(r, f, locked: false))
                    .Concat((r.LockedFiles ?? []).Select(f => Flatten(r, f, locked: true))))
                .DistinctBy(h => (h.Username, h.Filename))
                .OrderByDescending(h => h.HasFreeUploadSlot)
                .ThenByDescending(h => h.UploadSpeed)
                .ThenByDescending(h => h.BitRate ?? 0)
                .ToArray();

            return new SoulseekSearchResult(
                Id: searchId,
                IsComplete: status.IsComplete,
                ResponseCount: responses.Length,
                Hits: hits);
        }
        catch (HttpRequestException ex) { throw MapHttp(ex); }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested) { throw MapTimeout(ex); }
    }

    public async Task QueueDownloadAsync(string username, string filename, long size, CancellationToken ct)
    {
        if (!options.IsConfigured) throw new SoulseekNotConfiguredException();

        var body = new[] { new { filename, size } };
        try
        {
            using var resp = await Client("Wisp.Soulseek.Queue").PostAsJsonAsync(
                Url($"transfers/downloads/{Uri.EscapeDataString(username)}"), body, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var error = await resp.Content.ReadAsStringAsync(ct);
                throw new InvalidOperationException(
                    $"slskd refused download ({(int)resp.StatusCode}): {Truncate(error, 200)}");
            }
            // slskd can return HTTP 201 with an empty Enqueued list and a Failed
            // list (e.g. an already-active download). HTTP success alone is not
            // evidence that the file was queued.
            if (resp.StatusCode == System.Net.HttpStatusCode.Created)
            {
                var acknowledgement = await resp.Content.ReadFromJsonAsync<QueueAcknowledgement>(ct);
                if (acknowledgement?.Enqueued?.Any(file => file.Filename == filename) != true)
                    throw new InvalidOperationException("Soulseek did not queue this file. It may already be downloading; refresh transfers or try another result.");
            }
        }
        catch (HttpRequestException ex) { throw MapHttp(ex); }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested)
        { throw new SoulseekUnreachableException("The peer took too long to acknowledge this download. Check transfers before retrying: slskd may still finish queueing it.", ex); }
    }

    /// Asks slskd for its currently-configured download folder via `/api/v0/options`.
    /// Briefly cached; external daemons can be restarted independently of Wisp.
    /// Returns null on failure so callers can fall back to the managed sidecar's launch folder.
    public async Task<string?> GetEffectiveDownloadFolderAsync(CancellationToken ct)
    {
        if (!options.IsConfigured) return null;
        if (_downloadFolderCache is not null && _downloadFolderCacheUrl == options.Url && DateTime.UtcNow < _downloadFolderCacheUntil)
            return _downloadFolderCache;

        try
        {
            using var resp = await Client().GetAsync(Url("options"), ct);
            if (!resp.IsSuccessStatusCode) return null;
            using var doc = await resp.Content.ReadFromJsonAsync<System.Text.Json.JsonDocument>(ct);
            if (doc is null) return null;
            if (doc.RootElement.TryGetProperty("directories", out var dirs) &&
                dirs.TryGetProperty("downloads", out var downloads) &&
                downloads.ValueKind == System.Text.Json.JsonValueKind.String)
            {
                var path = downloads.GetString();
                if (!string.IsNullOrWhiteSpace(path))
                {
                    _downloadFolderCache = path;
                    _downloadFolderCacheUrl = options.Url;
                    _downloadFolderCacheUntil = DateTime.UtcNow.AddSeconds(15);
                    _log.LogInformation("Soulseek: discovered slskd download folder via options API: {Path}", path);
                    return path;
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Could not read slskd options for download folder");
        }
        return null;
    }
    private string? _downloadFolderCache;
    private string? _downloadFolderCacheUrl;
    private DateTime _downloadFolderCacheUntil;

    public Task<IReadOnlyList<SoulseekTransfer>> ListDownloadsAsync(CancellationToken ct) => ListTransfersAsync("downloads", ct);
    public Task<IReadOnlyList<SoulseekTransfer>> ListUploadsAsync(CancellationToken ct) => ListTransfersAsync("uploads", ct);

    private async Task<IReadOnlyList<SoulseekTransfer>> ListTransfersAsync(string direction, CancellationToken ct)
    {
        if (!options.IsConfigured) throw new SoulseekNotConfiguredException();
        try
        {
            using var resp = await Client().GetAsync(Url($"transfers/{direction}"), ct);
            resp.EnsureSuccessStatusCode();
            var users = await resp.Content.ReadFromJsonAsync<UserDownloads[]>(ct) ?? [];

            return users
                .SelectMany(u => (u.Directories ?? []).SelectMany(d => (d.Files ?? []).Select(f => new
                {
                    Username = u.Username,
                    File = f,
                })))
                .Select(x => new SoulseekTransfer(
                    Id: x.File.Id ?? "",
                    Username: x.Username ?? "",
                    Filename: x.File.Filename ?? "",
                    Size: x.File.Size,
                    BytesTransferred: x.File.BytesTransferred,
                    Percentage: x.File.PercentComplete,
                    State: x.File.State ?? "",
                    StartedAt: x.File.StartedAt,
                    EndedAt: x.File.EndedAt)
                {
                    AverageSpeed = x.File.AverageSpeed,
                    PlaceInQueue = x.File.PlaceInQueue,
                    Error = x.File.Exception,
                })
                .ToArray();
        }
        catch (HttpRequestException ex) { throw MapHttp(ex); }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested) { throw MapTimeout(ex); }
    }

    // ─── helpers ─────────────────────────────────────────────────────

    /// slskd 0.25.1 cancels a transfer with DELETE; remove=true also removes
    /// its history record. Neither option invokes the file-management API.
    public async Task CancelDownloadAsync(string username, string id, bool remove, CancellationToken ct)
    {
        if (!options.IsConfigured) throw new SoulseekNotConfiguredException();
        try
        {
            using var response = await Client().DeleteAsync(Url(
                $"transfers/downloads/{Uri.EscapeDataString(username)}/{Uri.EscapeDataString(id)}?remove={remove.ToString().ToLowerInvariant()}"), ct);
            // Clearing a record already removed in slskd is idempotent.
            if (remove && response.StatusCode == System.Net.HttpStatusCode.NotFound) return;
            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException($"slskd refused to {(remove ? "clear" : "cancel")} this transfer (HTTP {(int)response.StatusCode}). Refresh the list and try again.");
        }
        catch (HttpRequestException ex) { throw MapHttp(ex); }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested) { throw MapTimeout(ex); }
    }

    public Task CancelUploadAsync(string username, string id, CancellationToken ct) => RequestAsync<object>(HttpMethod.Delete,
        $"transfers/uploads/{Uri.EscapeDataString(username)}/{Uri.EscapeDataString(id)}", null, ct);

    private HttpClient Client(string name = "Wisp.Soulseek")
    {
        var http = httpFactory.CreateClient(name);
        http.DefaultRequestHeaders.Remove("X-API-Key");
        http.DefaultRequestHeaders.Add("X-API-Key", options.ApiKey!);
        return http;
    }

    private string Url(string path)
    {
        var baseUrl = options.Url!.TrimEnd('/');
        return $"{baseUrl}/api/v0/{path}";
    }

    private static SoulseekSearchHit Flatten(SearchResponse r, SearchFile f, bool locked) => new(
        Username: r.Username ?? "",
        Filename: f.Filename ?? "",
        Size: f.Size,
        BitRate: f.BitRate,
        SampleRate: f.SampleRate,
        BitDepth: f.BitDepth,
        Length: f.Length,
        Locked: locked,
        UploadSpeed: r.UploadSpeed,
        QueueLength: r.QueueLength,
        HasFreeUploadSlot: r.HasFreeUploadSlot);

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max] + "…";

    // ─── DTOs ────────────────────────────────────────────────────────

    private sealed record ServerStatus(bool IsConnected, bool IsLoggedIn, bool IsTransitioning, string? Username);
    private sealed record ApplicationShares(SoulseekShareScan? Shares);
    private sealed record QueueAcknowledgement(QueuedFile[]? Enqueued);
    private sealed record QueuedFile(string Filename);

    private sealed record SearchStatus(
        [property: JsonPropertyName("isComplete")] bool IsComplete,
        [property: JsonPropertyName("state")] string? State);

    private sealed record SearchResponse(
        [property: JsonPropertyName("username")] string? Username,
        [property: JsonPropertyName("uploadSpeed")] int UploadSpeed,
        [property: JsonPropertyName("queueLength")] int QueueLength,
        [property: JsonPropertyName("hasFreeUploadSlot")] bool HasFreeUploadSlot,
        [property: JsonPropertyName("files")] SearchFile[]? Files,
        [property: JsonPropertyName("lockedFiles")] SearchFile[]? LockedFiles);

    private sealed record SearchFile(
        [property: JsonPropertyName("filename")] string? Filename,
        [property: JsonPropertyName("size")] long Size,
        [property: JsonPropertyName("bitRate")] int? BitRate,
        [property: JsonPropertyName("sampleRate")] int? SampleRate,
        [property: JsonPropertyName("bitDepth")] int? BitDepth,
        [property: JsonPropertyName("length")] int? Length);

    private sealed record UserDownloads(
        [property: JsonPropertyName("username")] string? Username,
        [property: JsonPropertyName("directories")] DownloadDirectory[]? Directories);

    private sealed record DownloadDirectory(
        [property: JsonPropertyName("directory")] string? Directory,
        [property: JsonPropertyName("files")] DownloadFile[]? Files);

    private sealed record DownloadFile(
        [property: JsonPropertyName("id")] string? Id,
        [property: JsonPropertyName("filename")] string? Filename,
        [property: JsonPropertyName("size")] long Size,
        [property: JsonPropertyName("bytesTransferred")] long BytesTransferred,
        [property: JsonPropertyName("percentComplete")] double PercentComplete,
        [property: JsonPropertyName("state")] string? State,
        [property: JsonPropertyName("startedAt")] DateTimeOffset? StartedAt,
        [property: JsonPropertyName("endedAt")] DateTimeOffset? EndedAt,
        [property: JsonPropertyName("averageSpeed")] double AverageSpeed,
        [property: JsonPropertyName("placeInQueue")] int? PlaceInQueue,
        [property: JsonPropertyName("exception")] string? Exception);
}
