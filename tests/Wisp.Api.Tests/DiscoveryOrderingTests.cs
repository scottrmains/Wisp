using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Wisp.Api.Discovery;
using Wisp.Core.Discovery;
using Wisp.Infrastructure.Discovery;
using Wisp.Infrastructure.ExternalCatalog.YouTube;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Tests;

public sealed class DiscoveryOrderingTests : IAsyncLifetime
{
    private readonly SqliteConnection _connection = new("Data Source=:memory:");
    private readonly Guid _sourceId = Guid.NewGuid();
    private readonly FakeYouTube _youtube = new();
    private WebApplication _app = null!;

    public async Task InitializeAsync()
    {
        await _connection.OpenAsync();
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddDbContext<WispDbContext>(o => o.UseSqlite(_connection));
        builder.Services.AddSingleton<IHttpClientFactory>(_youtube);
        builder.Services.AddSingleton(new YouTubeOptions { ApiKey = "fake-test-key" });
        builder.Services.AddSingleton<YouTubeCatalogClient>();
        builder.Services.AddSingleton<DiscoveryScanQueue>();
        builder.Services.AddSingleton<DiscoveryScanProgressBus>();
        builder.Services.AddScoped<LocalLibraryMatcher>();
        builder.Services.AddScoped<DigitalAvailabilityService>();
        _app = builder.Build();
        _app.MapDiscovery();
        await using var scope = _app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        await db.Database.MigrateAsync();
        db.DiscoverySources.Add(new DiscoverySource { Id = _sourceId, Name = "Test source", SourceType = DiscoverySourceType.YouTubeChannel, UploadsPlaylistId = "UP-test", ExternalSourceId = "test" });
        db.DiscoveredTracks.AddRange(
            Track("Old", new DateTime(2020, 1, 1), new DateTime(2026, 9, 3)),
            Track("New", new DateTime(2026, 9, 1), new DateTime(2026, 9, 2)),
            Track("Unknown", null, new DateTime(2026, 9, 1)));
        await db.SaveChangesAsync();
        await _app.StartAsync();
    }

    private DiscoveredTrack Track(string title, DateTime? published, DateTime imported) => new()
    {
        Id = Guid.NewGuid(), DiscoverySourceId = _sourceId, SourceVideoId = title,
        RawTitle = "Artist - " + title, ParsedTitle = title, PublishedAt = published, ImportedAt = imported,
    };

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        await _connection.DisposeAsync();
    }

    private sealed record Page(int Total, int UndatedCount, DiscoveredTrackDto[] Items);

    [Fact]
    public async Task Rescan_acceptance_is_json_and_repeated_posts_queue_only_once()
    {
        var client = _app.GetTestClient();
        for (var i = 0; i < 2; i++)
        {
            var response = await client.PostAsync($"/api/discovery/sources/{_sourceId}/scan", null);
            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
            var body = await response.Content.ReadFromJsonAsync<Dictionary<string, Guid>>();
            Assert.Equal(_sourceId, body!["sourceId"]);
        }
        var queue = _app.Services.GetRequiredService<DiscoveryScanQueue>();
        Assert.True(queue.Reader.TryRead(out _));
        Assert.False(queue.Reader.TryRead(out _));
    }

    [Theory]
    [InlineData("", "New,Old,Unknown")]
    [InlineData("-published", "New,Old,Unknown")]
    [InlineData("published", "Old,New,Unknown")]
    [InlineData("-imported", "Old,New,Unknown")]
    [InlineData("imported", "Unknown,New,Old")]
    public async Task Sorts_before_pagination_with_unknown_upload_dates_last(string sort, string expected)
    {
        var client = _app.GetTestClient();
        var full = await client.GetFromJsonAsync<Page>($"/api/discovery/sources/{_sourceId}/tracks?sort={sort}");
        Assert.Equal(expected.Split(','), full!.Items.Select(t => t.ParsedTitle));
        Assert.Equal(1, full.UndatedCount);
        var second = await client.GetFromJsonAsync<Page>($"/api/discovery/sources/{_sourceId}/tracks?sort={sort}&page=2&size=1");
        Assert.Equal(expected.Split(',')[1], Assert.Single(second!.Items).ParsedTitle);
        Assert.All(full.Items.Where(t => t.PublishedAt.HasValue), t => Assert.Equal(DateTimeKind.Utc, t.PublishedAt!.Value.Kind));
    }

    [Fact]
    public async Task Filters_and_source_scope_remain_intact_and_invalid_sort_is_rejected()
    {
        var client = _app.GetTestClient();
        var filtered = await client.GetFromJsonAsync<Page>($"/api/discovery/sources/{_sourceId}/tracks?sort=published&search=New&status=New");
        Assert.Equal("New", Assert.Single(filtered!.Items).ParsedTitle);
        Assert.Equal(0, filtered.UndatedCount);
        var other = await client.GetFromJsonAsync<Page>($"/api/discovery/sources/{Guid.NewGuid()}/tracks");
        Assert.Empty(other!.Items);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync($"/api/discovery/sources/{_sourceId}/tracks?sort=nonsense")).StatusCode);
    }

    [Fact]
    public async Task Equal_upload_dates_have_stable_page_boundaries()
    {
        await using var scope = _app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        await db.DiscoveredTracks.ExecuteUpdateAsync(s => s.SetProperty(t => t.PublishedAt, new DateTime(2026, 1, 1)));
        var client = _app.GetTestClient();
        var full = await client.GetFromJsonAsync<Page>($"/api/discovery/sources/{_sourceId}/tracks");
        var ids = new List<Guid>();
        for (var page = 1; page <= 3; page++)
        {
            var part = await client.GetFromJsonAsync<Page>($"/api/discovery/sources/{_sourceId}/tracks?size=1&page={page}");
            ids.Add(Assert.Single(part!.Items).Id);
        }
        Assert.Equal(full!.Items.Select(t => t.Id), ids);
        Assert.Equal(3, ids.Distinct().Count());
    }

    [Theory]
    [InlineData(DiscoverySourceType.YouTubeChannel)]
    [InlineData(DiscoverySourceType.YouTubePlaylist)]
    public async Task Rescan_backfills_publication_dates_preserving_prep_and_deduplicating_pages(DiscoverySourceType type)
    {
        await using var scope = _app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        var source = await db.DiscoverySources.SingleAsync();
        source.SourceType = type;
        var track = await db.DiscoveredTracks.SingleAsync(t => t.SourceVideoId == "New");
        track.PublishedAt = null;
        track.ParsedTitle = "Manual correction";
        track.Status = DiscoveryStatus.Want;
        track.IsAlreadyInLibrary = true;
        var originalId = track.Id;
        var originalImport = track.ImportedAt;
        await db.SaveChangesAsync();
        var bus = _app.Services.GetRequiredService<DiscoveryScanProgressBus>();
        var scanner = new DiscoveryScanner(db, _app.Services.GetRequiredService<YouTubeCatalogClient>(), bus, NullLogger<DiscoveryScanner>.Instance);
        await scanner.RunAsync(new DiscoveryScanRequest(_sourceId), CancellationToken.None);
        Assert.Equal(1, bus.Latest(_sourceId)!.NewItems);
        Assert.Equal(1, bus.Latest(_sourceId)!.UpdatedDates);
        await scanner.RunAsync(new DiscoveryScanRequest(_sourceId), CancellationToken.None);
        Assert.Equal(0, bus.Latest(_sourceId)!.NewItems);
        Assert.Equal(0, bus.Latest(_sourceId)!.UpdatedDates);
        Assert.Equal(3, bus.Latest(_sourceId)!.CheckedItems);
        Assert.NotNull(bus.Latest(_sourceId)!.FinishedAt);
        // Request the stream only after the whole scan finished: this used to hang.
        var replay = await _app.GetTestClient().GetStringAsync($"/api/discovery/sources/{_sourceId}/scan/events").WaitAsync(TimeSpan.FromSeconds(3));
        Assert.Contains("\"status\":\"Completed\"", replay);
        Assert.Contains("\"newItems\":0", replay);
        db.ChangeTracker.Clear();
        var preserved = await db.DiscoveredTracks.SingleAsync(t => t.Id == originalId);
        Assert.Equal(new DateTime(2026, 9, 1, 12, 0, 0, DateTimeKind.Utc), preserved.PublishedAt);
        Assert.Equal("Manual correction", preserved.ParsedTitle);
        Assert.Equal(DiscoveryStatus.Want, preserved.Status);
        Assert.True(preserved.IsAlreadyInLibrary);
        Assert.Equal(originalImport, preserved.ImportedAt);
        Assert.Equal(4, await db.DiscoveredTracks.CountAsync());
        Assert.Equal(4, (await db.DiscoverySources.SingleAsync()).ImportedCount);
        // A recently added playlist entry is not necessarily a recently uploaded video.
        Assert.Null((await db.DiscoveredTracks.SingleAsync(t => t.SourceVideoId == "Fresh")).PublishedAt);
        Assert.Equal(4, _youtube.PlaylistPageRequests);
    }

    private sealed class FakeYouTube : HttpMessageHandler, IHttpClientFactory
    {
        public int PlaylistPageRequests { get; private set; }
        public HttpClient CreateClient(string name) => new(this, disposeHandler: false);
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            object Video(string id, string? published) => new
            {
                snippet = new { title = "Artist - " + id, publishedAt = "2026-09-10T00:00:00Z" },
                contentDetails = new { videoId = id, videoPublishedAt = published },
            };
            object body;
            if (request.RequestUri!.AbsolutePath.EndsWith("/playlists"))
                body = new { items = new[] { new { id = "test", snippet = new { title = "Test source" } } } };
            else
            {
                PlaylistPageRequests++;
                body = request.RequestUri.Query.Contains("pageToken=")
                    ? new { items = new[] { Video("Old", "2020-01-01T00:00:00Z"), Video("Fresh", null) }, nextPageToken = (string?)null }
                    : new { items = new[] { Video("Old", "2020-01-01T00:00:00Z"), Video("New", "2026-09-01T13:00:00+01:00") }, nextPageToken = (string?)"next" };
            }
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(body) });
        }
    }
}
