using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wisp.Api.Discover;
using Wisp.Infrastructure.ArtistRefresh;
using Wisp.Infrastructure.ExternalCatalog.Spotify;
using Wisp.Infrastructure.ExternalCatalog.YouTube;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Tests;

public sealed class DiscoverSearchTests : IAsyncLifetime
{
    private readonly FakeYouTube _youtube = new();
    private WebApplication _app = null!;

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddSingleton<IHttpClientFactory>(_youtube);
        builder.Services.AddSingleton(new YouTubeOptions { ApiKey = "fake-test-key" });
        builder.Services.AddSingleton(new SpotifyOptions());
        builder.Services.AddSingleton<YouTubeCatalogClient>();
        builder.Services.AddSingleton<SpotifyCatalogClient>();
        builder.Services.AddSingleton<YouTubeQuotaTracker>();
        builder.Services.AddDbContext<WispDbContext>(o => o.UseSqlite("Data Source=:memory:"));
        builder.Services.AddScoped<ArtistRefreshService>();
        _app = builder.Build();
        _app.MapDiscover();
        await _app.StartAsync();
    }
    public Task DisposeAsync() => _app.DisposeAsync().AsTask();

    private async Task<DiscoverSearchResponse> Search(string query, string sources = "youtube") =>
        (await _app.GetTestClient().GetFromJsonAsync<DiscoverSearchResponse>(
            $"/api/discover/search?q={Uri.EscapeDataString(query)}&sources={sources}"))!;

    [Fact]
    public async Task Track_search_has_no_music_filter_topic_detour_or_result_truncation()
    {
        var result = await Search("Brent Laurence - Big Buds");
        Assert.Equal("keTtiDqQrpc", result.Videos.First().VideoId);
        Assert.Equal(25, result.Videos.Length);
        Assert.Equal("Brent Laurence - Big Buds", result.Videos.First().Title);
        Assert.Equal("Fan's & vinyl uploads", result.Videos.First().ChannelTitle);
        var request = Assert.Single(_youtube.Requests);
        var query = QueryHelpers.ParseQuery(request.Query);
        Assert.Equal("video", query["type"]);
        Assert.Equal("relevance", query["order"]);
        Assert.Equal("25", query["maxResults"]);
        Assert.Equal("Brent Laurence Big Buds", query["q"]);
        Assert.False(query.ContainsKey("videoCategoryId"));
        Assert.False(query.ContainsKey("channelId"));
        Assert.Equal(1, result.YouTubeQuota!.SearchesToday);
        Assert.Empty(result.Errors);
        await Search("  brent   laurence — big buds  ");
        Assert.Single(_youtube.Requests);
    }

    [Theory]
    [InlineData("https://www.youtube.com/watch?v=keTtiDqQrpc&list=LL&index=25")]
    [InlineData("https://youtu.be/keTtiDqQrpc?t=20")]
    [InlineData("https://m.youtube.com/shorts/keTtiDqQrpc")]
    public async Task Known_link_resolves_directly_even_when_search_budget_is_used(string url)
    {
        var quota = _app.Services.GetRequiredService<YouTubeQuotaTracker>();
        for (var i = 0; i < YouTubeQuotaTracker.DailyBudget; i++) quota.TryConsume();
        var result = await Search(url, "spotify,youtube");
        Assert.Equal("keTtiDqQrpc", Assert.Single(result.Videos).VideoId);
        Assert.EndsWith("/videos", Assert.Single(_youtube.Requests).AbsolutePath);
        Assert.Empty(result.Errors); // Do not send a video URL to Spotify artist search.
        Assert.Equal(YouTubeQuotaTracker.DailyBudget, result.YouTubeQuota!.SearchesToday);
    }

    [Fact]
    public async Task Video_ids_do_not_collide_by_case_in_the_cache()
    {
        Assert.Equal("keTtiDqQrpc", Assert.Single((await Search("https://youtu.be/keTtiDqQrpc")).Videos).VideoId);
        Assert.Equal("kettiDqQrpc", Assert.Single((await Search("https://youtu.be/kettiDqQrpc")).Videos).VideoId);
        Assert.Equal(2, _youtube.Requests.Count);
    }

    [Theory]
    [InlineData(403, "youtube_quota_exhausted")]
    [InlineData(500, "youtube_failed")]
    public async Task Provider_failures_are_visible_and_not_cached_as_empty_success(int status, string error)
    {
        _youtube.Status = (HttpStatusCode)status;
        var failed = await Search("Brent Laurence Big Buds");
        Assert.Contains(error, failed.Errors);
        Assert.Empty(failed.Videos);
        _youtube.Status = HttpStatusCode.OK;
        Assert.NotEmpty((await Search("Brent Laurence Big Buds")).Videos);
        Assert.Equal(2, _youtube.Requests.Count);
    }

    [Fact]
    public async Task Empty_search_can_be_retried_and_unavailable_video_is_explained()
    {
        _youtube.Empty = true;
        Assert.Empty((await Search("Brent Laurence Big Buds")).Videos);
        Assert.Contains("youtube_video_unavailable", (await Search("https://youtu.be/keTtiDqQrpc")).Errors);
        _youtube.Empty = false;
        Assert.NotEmpty((await Search("Brent Laurence Big Buds")).Videos);
    }

    [Fact]
    public async Task Spotify_failure_or_disabled_source_does_not_hide_youtube_results()
    {
        var result = await Search("Brent Laurence Big Buds", "spotify,youtube");
        Assert.Contains("spotify_unconfigured", result.Errors);
        Assert.NotEmpty(result.Videos);
        var disabled = await Search("another song", "spotify");
        Assert.Empty(disabled.Videos);
        Assert.Single(_youtube.Requests);
    }

    [Theory]
    [InlineData("https://youtube.com.evil.test/watch?v=keTtiDqQrpc")]
    [InlineData("https://evil.test/?v=keTtiDqQrpc")]
    [InlineData("https://youtube.com/watch?v=bad")]
    [InlineData("https://youtube.com/playlist?list=PL123")]
    public void Only_valid_youtube_video_links_are_direct_lookups(string query) =>
        Assert.Null(YouTubeSearchQuery.VideoId(query));

    [Fact]
    public void Query_normalization_preserves_hyphenated_names_and_exclusion_operators()
    {
        Assert.Equal("AC-DC Thunderstruck -live", YouTubeSearchQuery.Normalize(" AC-DC - Thunderstruck  -live "));
    }

    private sealed class FakeYouTube : HttpMessageHandler, IHttpClientFactory
    {
        public HttpStatusCode Status = HttpStatusCode.OK;
        public bool Empty;
        public List<Uri> Requests = [];
        public HttpClient CreateClient(string name) => new(this, disposeHandler: false);
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var uri = request.RequestUri!;
            Requests.Add(uri);
            if (Status != HttpStatusCode.OK)
                return Task.FromResult(new HttpResponseMessage(Status) { Content = JsonContent.Create(new { error = new { errors = new[] { new { reason = "quotaExceeded" } } } }) });
            var query = QueryHelpers.ParseQuery(uri.Query);
            object snippet = new { title = "Brent Laurence - Big Buds", channelTitle = "Fan&#39;s &amp; vinyl uploads", publishedAt = "2020-01-01T00:00:00Z" };
            object[] items = Empty ? [] : uri.AbsolutePath.EndsWith("/videos")
                ? [new { id = query["id"].ToString(), snippet }]
                : Enumerable.Range(0, 25).Select(i => (object)new { id = new { videoId = i == 0 ? "keTtiDqQrpc" : "other" + i }, snippet }).ToArray();
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(new { items }) });
        }
    }
}
