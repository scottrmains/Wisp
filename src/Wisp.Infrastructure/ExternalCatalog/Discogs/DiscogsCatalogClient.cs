using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace Wisp.Infrastructure.ExternalCatalog.Discogs;

public sealed class DiscogsNotConfiguredException() : Exception("Discogs personal access token is not configured.");

public sealed class DiscogsCatalogClient(
    IHttpClientFactory httpFactory,
    DiscogsOptions options,
    ILogger<DiscogsCatalogClient> log)
{
    private const string ApiBase = "https://api.discogs.com";

    public bool IsConfigured => options.IsConfigured;

    public async Task<string?> TestConnectionAsync(CancellationToken ct)
    {
        if (!options.IsConfigured) return "Personal access token not set.";
        try
        {
            // /oauth/identity validates the token without consuming search quota.
            var http = AuthorizedClient();
            using var resp = await http.GetAsync($"{ApiBase}/oauth/identity", ct);
            if (resp.IsSuccessStatusCode) return null;
            var body = await resp.Content.ReadAsStringAsync(ct);
            return $"Discogs auth failed: {(int)resp.StatusCode}. {Truncate(body, 160)}";
        }
        catch (Exception ex)
        {
            return ex.Message;
        }
    }

    public async Task<IReadOnlyList<CatalogArtistCandidate>> SearchArtistsAsync(
        string name, int limit, CancellationToken ct)
    {
        if (!options.IsConfigured) throw new DiscogsNotConfiguredException();

        var http = AuthorizedClient();
        var url = $"{ApiBase}/database/search?type=artist&per_page={Math.Clamp(limit, 1, 25)}&q={Uri.EscapeDataString(name)}";
        using var resp = await SendWithRetry(() => http.GetAsync(url, ct), ct);
        resp.EnsureSuccessStatusCode();

        var body = await resp.Content.ReadFromJsonAsync<DiscogsSearchResponse>(ct);
        var results = body?.Results ?? [];

        return results
            .Where(r => string.Equals(r.Type, "artist", StringComparison.OrdinalIgnoreCase))
            .Select(r => new CatalogArtistCandidate(
                Source: "Discogs",
                ExternalId: r.Id.ToString(),
                Name: r.Title ?? "",
                Followers: null,
                Genres: [],
                ImageUrl: r.CoverImage ?? r.Thumb))
            .ToArray();
    }

    public async Task<IReadOnlyList<CatalogReleaseSummary>> GetArtistReleasesAsync(
        string discogsArtistId, CancellationToken ct)
    {
        if (!options.IsConfigured) throw new DiscogsNotConfiguredException();

        var http = AuthorizedClient();
        var results = new List<CatalogReleaseSummary>();
        // Discogs paginates artist releases with `page` + `per_page`; sort by year desc.
        var url = $"{ApiBase}/artists/{Uri.EscapeDataString(discogsArtistId)}" +
                  "/releases?sort=year&sort_order=desc&per_page=100";

        while (!string.IsNullOrEmpty(url))
        {
            using var resp = await SendWithRetry(() => http.GetAsync(url, ct), ct);
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadFromJsonAsync<DiscogsReleasesResponse>(ct);
            if (body is null) break;

            foreach (var item in body.Releases ?? [])
            {
                if (string.IsNullOrEmpty(item.Title)) continue;

                results.Add(new CatalogReleaseSummary(
                    Source: "Discogs",
                    ExternalId: $"{item.Type ?? "release"}:{item.Id}",
                    Title: item.Title,
                    ReleaseType: NormaliseType(item.Type, item.Format),
                    ReleaseDate: ParseYear(item.Year),
                    Url: BuildUrl(item),
                    ArtworkUrl: item.Thumb));
            }

            // Cap at 500 entries to avoid runaway requests on prolific artists.
            if (results.Count >= 500) break;
            url = body.Pagination?.Urls?.Next;
        }

        log.LogInformation("Discogs: {Artist} → {Count} releases", discogsArtistId, results.Count);
        return results;
    }

    private HttpClient AuthorizedClient()
    {
        var http = httpFactory.CreateClient("Wisp.Discogs");
        http.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Discogs", $"token={options.PersonalAccessToken}");
        http.DefaultRequestHeaders.UserAgent.Clear();
        if (ProductInfoHeaderValue.TryParse(options.UserAgent, out var ua))
            http.DefaultRequestHeaders.UserAgent.Add(ua);
        return http;
    }

    private static async Task<HttpResponseMessage> SendWithRetry(
        Func<Task<HttpResponseMessage>> send, CancellationToken ct)
    {
        var resp = await send();
        if (resp.StatusCode != HttpStatusCode.TooManyRequests) return resp;

        var delay = resp.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(2);
        if (delay < TimeSpan.Zero) delay = TimeSpan.FromSeconds(2);
        if (delay > TimeSpan.FromMinutes(1)) delay = TimeSpan.FromMinutes(1);

        resp.Dispose();
        await Task.Delay(delay, ct);
        return await send();
    }

    private static string NormaliseType(string? type, string? format)
    {
        // Discogs `type` is "release" | "master". Format like "Vinyl, 12", 33 ⅓ RPM, EP" or "File, MP3, Album".
        if (!string.IsNullOrEmpty(format))
        {
            var f = format.ToLowerInvariant();
            if (f.Contains(" ep") || f.StartsWith("ep")) return "ep";
            if (f.Contains("compilation")) return "compilation";
            if (f.Contains("single")) return "single";
            if (f.Contains("album")) return "album";
        }
        return type ?? "album";
    }

    private static DateOnly? ParseYear(int? year) =>
        year is > 0 ? new DateOnly(year.Value, 1, 1) : null;

    private static string? BuildUrl(DiscogsReleaseItem r)
    {
        if (string.IsNullOrEmpty(r.ResourceUrl)) return null;
        // resource_url points at the API. We want the human page.
        return r.Type?.ToLowerInvariant() switch
        {
            "master" => $"https://www.discogs.com/master/{r.Id}",
            _ => $"https://www.discogs.com/release/{r.Id}",
        };
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max] + "…";

    // ─── DTOs ───────────────────────────────────────────────────────────

    private sealed record DiscogsSearchResponse(
        [property: JsonPropertyName("results")] DiscogsSearchResult[] Results);

    private sealed record DiscogsSearchResult(
        [property: JsonPropertyName("id")] long Id,
        [property: JsonPropertyName("type")] string? Type,
        [property: JsonPropertyName("title")] string? Title,
        [property: JsonPropertyName("thumb")] string? Thumb,
        [property: JsonPropertyName("cover_image")] string? CoverImage);

    private sealed record DiscogsReleasesResponse(
        [property: JsonPropertyName("pagination")] DiscogsPagination? Pagination,
        [property: JsonPropertyName("releases")] DiscogsReleaseItem[] Releases);

    private sealed record DiscogsPagination(
        [property: JsonPropertyName("urls")] DiscogsPaginationUrls? Urls);

    private sealed record DiscogsPaginationUrls(
        [property: JsonPropertyName("next")] string? Next);

    private sealed record DiscogsReleaseItem(
        [property: JsonPropertyName("id")] long Id,
        [property: JsonPropertyName("type")] string? Type,
        [property: JsonPropertyName("title")] string? Title,
        [property: JsonPropertyName("year")] int? Year,
        [property: JsonPropertyName("format")] string? Format,
        [property: JsonPropertyName("label")] string? Label,
        [property: JsonPropertyName("role")] string? Role,
        [property: JsonPropertyName("thumb")] string? Thumb,
        [property: JsonPropertyName("resource_url")] string? ResourceUrl);
}
