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
        catch (HttpRequestException ex)
        {
            throw new SoulseekUnreachableException($"Could not reach slskd: {ex.Message}", ex);
        }
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
        catch (HttpRequestException ex)
        {
            throw new SoulseekUnreachableException($"Could not reach slskd: {ex.Message}", ex);
        }
    }

    public async Task QueueDownloadAsync(string username, string filename, long size, CancellationToken ct)
    {
        if (!options.IsConfigured) throw new SoulseekNotConfiguredException();

        var body = new[] { new { filename, size } };
        try
        {
            using var resp = await Client().PostAsJsonAsync(
                Url($"transfers/downloads/{Uri.EscapeDataString(username)}"), body, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var error = await resp.Content.ReadAsStringAsync(ct);
                throw new InvalidOperationException(
                    $"slskd refused download ({(int)resp.StatusCode}): {Truncate(error, 200)}");
            }
        }
        catch (HttpRequestException ex)
        {
            throw new SoulseekUnreachableException($"Could not reach slskd: {ex.Message}", ex);
        }
    }

    public async Task<IReadOnlyList<SoulseekTransfer>> ListDownloadsAsync(CancellationToken ct)
    {
        if (!options.IsConfigured) throw new SoulseekNotConfiguredException();
        try
        {
            using var resp = await Client().GetAsync(Url("transfers/downloads"), ct);
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
                    EndedAt: x.File.EndedAt))
                .ToArray();
        }
        catch (HttpRequestException ex)
        {
            throw new SoulseekUnreachableException($"Could not reach slskd: {ex.Message}", ex);
        }
    }

    // ─── helpers ─────────────────────────────────────────────────────

    private HttpClient Client()
    {
        var http = httpFactory.CreateClient("Wisp.Soulseek");
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
        [property: JsonPropertyName("endedAt")] DateTimeOffset? EndedAt);
}
