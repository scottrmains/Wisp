using System.Net;
using System.Net.Http.Json;
using System.Net.Http.Headers;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace Wisp.Infrastructure.ExternalCatalog.Spotify;

public sealed class SpotifyAuthException(string message) : Exception(message);
public sealed class SpotifyNotConfiguredException() : Exception("Spotify client ID/secret are not configured.");

public sealed class SpotifyCatalogClient(
    IHttpClientFactory httpFactory,
    SpotifyOptions options,
    ILogger<SpotifyCatalogClient> log)
{
    private const string TokenUrl = "https://accounts.spotify.com/api/token";
    private const string ApiBase = "https://api.spotify.com/v1";

    private string? _token;
    private DateTimeOffset _tokenExpiresAt = DateTimeOffset.MinValue;
    private readonly SemaphoreSlim _tokenLock = new(1, 1);

    public bool IsConfigured => options.IsConfigured;

    /// Lightweight credential check used by the Settings "Test connection" button.
    /// Returns null on success or a short error message on failure.
    public async Task<string?> TestConnectionAsync(CancellationToken ct)
    {
        if (!options.IsConfigured) return "Client ID / Secret not set.";
        try
        {
            await GetTokenAsync(forceRefresh: true, ct);
            return null;
        }
        catch (Exception ex)
        {
            return ex.Message;
        }
    }

    public async Task<IReadOnlyList<CatalogArtistCandidate>> SearchArtistsAsync(
        string name, int limit, CancellationToken ct)
    {
        if (!options.IsConfigured) throw new SpotifyNotConfiguredException();

        var http = await AuthorizedClient(ct);
        var url = $"{ApiBase}/search?type=artist&limit={Math.Clamp(limit, 1, 20)}&q={Uri.EscapeDataString(name)}";
        using var resp = await SendWithRetry(() => http.GetAsync(url, ct), ct);
        resp.EnsureSuccessStatusCode();

        var body = await resp.Content.ReadFromJsonAsync<SpotifySearchResponse>(ct);
        var items = body?.Artists?.Items ?? [];
        return items
            .Select(a => new CatalogArtistCandidate(
                Source: "Spotify",
                ExternalId: a.Id,
                Name: a.Name,
                Followers: a.Followers?.Total,
                Genres: a.Genres ?? [],
                ImageUrl: a.Images?.FirstOrDefault()?.Url))
            .ToArray();
    }

    public async Task<IReadOnlyList<CatalogReleaseSummary>> GetArtistAlbumsAsync(
        string spotifyArtistId, CancellationToken ct)
    {
        if (!options.IsConfigured) throw new SpotifyNotConfiguredException();

        var http = await AuthorizedClient(ct);
        var results = new List<CatalogReleaseSummary>();
        var url = $"{ApiBase}/artists/{Uri.EscapeDataString(spotifyArtistId)}" +
                  "/albums?include_groups=album,single,appears_on&limit=50";

        // Page until next is null. Spotify's `next` field is the absolute URL of the next page.
        while (!string.IsNullOrEmpty(url))
        {
            using var resp = await SendWithRetry(() => http.GetAsync(url, ct), ct);
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadFromJsonAsync<SpotifyAlbumsResponse>(ct);
            if (body is null) break;

            foreach (var item in body.Items ?? [])
            {
                results.Add(new CatalogReleaseSummary(
                    Source: "Spotify",
                    ExternalId: item.Id,
                    Title: item.Name,
                    ReleaseType: item.AlbumType ?? item.AlbumGroup ?? "album",
                    ReleaseDate: ParseSpotifyDate(item.ReleaseDate, item.ReleaseDatePrecision),
                    Url: item.ExternalUrls?.Spotify,
                    ArtworkUrl: item.Images?.FirstOrDefault()?.Url));
            }

            url = body.Next;
        }

        return results;
    }

    // ─── auth ────────────────────────────────────────────────────────────

    private async Task<HttpClient> AuthorizedClient(CancellationToken ct)
    {
        var token = await GetTokenAsync(forceRefresh: false, ct);
        var http = httpFactory.CreateClient("Wisp.Spotify");
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return http;
    }

    private async Task<string> GetTokenAsync(bool forceRefresh, CancellationToken ct)
    {
        if (!options.IsConfigured) throw new SpotifyNotConfiguredException();

        if (!forceRefresh && _token is not null && DateTimeOffset.UtcNow < _tokenExpiresAt - TimeSpan.FromMinutes(1))
            return _token;

        await _tokenLock.WaitAsync(ct);
        try
        {
            if (!forceRefresh && _token is not null && DateTimeOffset.UtcNow < _tokenExpiresAt - TimeSpan.FromMinutes(1))
                return _token;

            var http = httpFactory.CreateClient("Wisp.Spotify.Auth");
            var basic = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes($"{options.ClientId}:{options.ClientSecret}"));
            using var req = new HttpRequestMessage(HttpMethod.Post, TokenUrl);
            req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
            req.Content = new FormUrlEncodedContent(new Dictionary<string, string> { ["grant_type"] = "client_credentials" });

            using var resp = await http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync(ct);
                throw new SpotifyAuthException($"Spotify auth failed: {(int)resp.StatusCode} {resp.StatusCode}. {Truncate(body, 200)}");
            }

            var token = await resp.Content.ReadFromJsonAsync<SpotifyTokenResponse>(ct)
                ?? throw new SpotifyAuthException("Spotify returned an empty token response.");

            _token = token.AccessToken;
            _tokenExpiresAt = DateTimeOffset.UtcNow.AddSeconds(token.ExpiresIn);
            log.LogInformation("Spotify token refreshed; expires in {ExpiresIn}s", token.ExpiresIn);
            return _token;
        }
        finally
        {
            _tokenLock.Release();
        }
    }

    /// One-shot 429 retry honouring Retry-After. Anything else bubbles up.
    private static async Task<HttpResponseMessage> SendWithRetry(
        Func<Task<HttpResponseMessage>> send,
        CancellationToken ct)
    {
        var resp = await send();
        if (resp.StatusCode != HttpStatusCode.TooManyRequests) return resp;

        var delay = resp.Headers.RetryAfter?.Delta
            ?? (resp.Headers.RetryAfter?.Date is { } d
                ? d - DateTimeOffset.UtcNow
                : TimeSpan.FromSeconds(2));
        if (delay < TimeSpan.Zero) delay = TimeSpan.FromSeconds(2);
        if (delay > TimeSpan.FromMinutes(1)) delay = TimeSpan.FromMinutes(1);

        resp.Dispose();
        await Task.Delay(delay, ct);
        return await send();
    }

    private static DateOnly? ParseSpotifyDate(string? raw, string? precision) =>
        string.IsNullOrEmpty(raw) ? null : precision switch
        {
            "year" => int.TryParse(raw, out var y) ? new DateOnly(y, 1, 1) : null,
            "month" => DateOnly.TryParseExact(raw, "yyyy-MM", out var m) ? m : null,
            _ => DateOnly.TryParse(raw, out var d) ? d : null,
        };

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max] + "…";

    // ─── DTOs ────────────────────────────────────────────────────────────

    private sealed record SpotifyTokenResponse(
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("token_type")] string TokenType,
        [property: JsonPropertyName("expires_in")] int ExpiresIn);

    private sealed record SpotifySearchResponse(
        [property: JsonPropertyName("artists")] SpotifyArtistsPage? Artists);

    private sealed record SpotifyArtistsPage(
        [property: JsonPropertyName("items")] SpotifyArtistItem[] Items);

    private sealed record SpotifyArtistItem(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("followers")] SpotifyFollowers? Followers,
        [property: JsonPropertyName("genres")] string[]? Genres,
        [property: JsonPropertyName("images")] SpotifyImage[]? Images);

    private sealed record SpotifyFollowers(
        [property: JsonPropertyName("total")] int Total);

    private sealed record SpotifyImage(
        [property: JsonPropertyName("url")] string Url,
        [property: JsonPropertyName("width")] int? Width,
        [property: JsonPropertyName("height")] int? Height);

    private sealed record SpotifyAlbumsResponse(
        [property: JsonPropertyName("items")] SpotifyAlbumItem[] Items,
        [property: JsonPropertyName("next")] string? Next);

    private sealed record SpotifyAlbumItem(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("album_type")] string? AlbumType,
        [property: JsonPropertyName("album_group")] string? AlbumGroup,
        [property: JsonPropertyName("release_date")] string? ReleaseDate,
        [property: JsonPropertyName("release_date_precision")] string? ReleaseDatePrecision,
        [property: JsonPropertyName("external_urls")] SpotifyExternalUrls? ExternalUrls,
        [property: JsonPropertyName("images")] SpotifyImage[]? Images);

    private sealed record SpotifyExternalUrls(
        [property: JsonPropertyName("spotify")] string? Spotify);
}
