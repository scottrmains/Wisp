using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wisp.Api.Library;
using Wisp.Api.Settings;
using Wisp.Api.Soulseek;
using Wisp.Core.Playlists;
using Wisp.Core.Recommendations;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.ExternalCatalog.Soulseek;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Tests;

public sealed class LibraryDatesAndDownloadsTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wisp-dates-test-" + Guid.NewGuid().ToString("N"));
    private readonly SqliteConnection _connection = new("Data Source=:memory:");
    private readonly FakeSlskd _daemon = new();
    private WebApplication _app = null!;
    private WispSettingsStore _store = null!;
    private readonly Guid _playlistId = Guid.NewGuid();
    private string Music => Path.Combine(_root, "music");
    private string Downloads => Path.Combine(_root, "downloads");

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(Music);
        Directory.CreateDirectory(Downloads);
        _daemon.Folder = Downloads;
        _store = new WispSettingsStore(Path.Combine(_root, "config.json"));
        _store.Update(s => s with { LastFolder = Music, Catalog = new CatalogCredentials
        {
            Soulseek = new SoulseekCredentials("http://test-slskd", "fake-key", Downloads, "test-user", "fake-password"),
            Spotify = new SpotifyCredentials("other-client", "other-secret"),
        }});
        await _connection.OpenAsync();
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddDbContext<WispDbContext>(o => o.UseSqlite(_connection));
        builder.Services.AddSingleton(_store);
        builder.Services.AddSingleton(new SoulseekOptions { Url = "http://test-slskd", ApiKey = "fake-key", DownloadFolder = Music });
        builder.Services.AddSingleton<IHttpClientFactory>(_daemon);
        builder.Services.AddSingleton<SoulseekClient>();
        builder.Services.AddSingleton<ScanQueue>();
        builder.Services.AddSingleton<ScanProgressBus>();
        builder.Services.AddSingleton<RecommendationService>();
        builder.Services.AddSingleton<AiffTranscoder>();
        _app = builder.Build();
        _app.MapLibrary();
        _app.MapSoulseek();
        _app.MapSoulseekDownloadSettings();
        await using var scope = _app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        await db.Database.MigrateAsync();
        var now = DateTime.UtcNow;
        var tracks = new[]
        {
            MakeTrack("Old", now.AddDays(-60), now.AddHours(-1)),
            MakeTrack("New", now.AddHours(-1), now.AddDays(-90)),
            MakeTrack("Unknown", now.AddDays(-3), null),
        };
        db.Tracks.AddRange(tracks);
        db.Playlists.Add(new Playlist { Id = _playlistId, Name = "Test", Tracks = tracks.Take(2)
            .Select(t => new PlaylistTrack { Id = Guid.NewGuid(), TrackId = t.Id, AddedAt = now }).ToList() });
        await db.SaveChangesAsync();
        await _app.StartAsync();
    }

    private Track MakeTrack(string title, DateTime added, DateTime? modified) => new()
    {
        Id = Guid.NewGuid(), FilePath = Path.Combine(Music, title + ".mp3"), FileName = title + ".mp3",
        FileHash = title, Title = title, AddedAt = added, FileModifiedAt = modified,
    };

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        await _connection.DisposeAsync();
        Directory.Delete(_root, true);
    }

    [Theory]
    [InlineData("-added", "New,Unknown,Old")]
    [InlineData("added", "Old,Unknown,New")]
    [InlineData("-modified", "Old,New,Unknown")]
    [InlineData("modified", "New,Old,Unknown")]
    public async Task Dates_sort_independently_with_unknown_dates_last(string sort, string expected)
    {
        var page = await _app.GetTestClient().GetFromJsonAsync<TrackPageDto>($"/api/tracks?sort={sort}");
        Assert.Equal(expected.Split(','), page!.Items.Select(t => t.Title));
        Assert.All(page.Items, t => Assert.Equal(DateTimeKind.Utc, t.AddedAt.Kind));
        Assert.All(page.Items.Where(t => t.FileModifiedAt.HasValue), t => Assert.Equal(DateTimeKind.Utc, t.FileModifiedAt!.Value.Kind));
    }

    [Fact]
    public async Task Date_filter_composes_with_playlist_scope_and_pagination()
    {
        var client = _app.GetTestClient();
        var recent = await client.GetFromJsonAsync<TrackPageDto>($"/api/tracks?playlistId={_playlistId}&addedWithinDays=7&sort=-added");
        Assert.Equal("New", Assert.Single(recent!.Items).Title);
        var page = await client.GetFromJsonAsync<TrackPageDto>($"/api/tracks?playlistId={_playlistId}&sort=-added&size=1&page=2");
        Assert.Equal(2, page!.Total);
        Assert.Equal("Old", Assert.Single(page.Items).Title);
        var empty = await client.GetFromJsonAsync<TrackPageDto>("/api/tracks?addedWithinDays=1&search=Old");
        Assert.Empty(empty!.Items);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/tracks?addedWithinDays=0")).StatusCode);
    }

    [Fact]
    public async Task Saving_folder_preserves_credentials_and_distinguishes_running_from_next_destination()
    {
        var client = _app.GetTestClient();
        (await client.PutAsJsonAsync("/api/settings/soulseek/download-folder", new { downloadFolder = Music })).EnsureSuccessStatusCode();
        var persisted = new WispSettingsStore(Path.Combine(_root, "config.json")).Current;
        Assert.Equal(Music, persisted.Catalog!.Soulseek!.DownloadFolder);
        Assert.Equal("fake-password", persisted.Catalog.Soulseek.Password);
        Assert.Equal("fake-key", persisted.Catalog.Soulseek.ApiKey);
        Assert.Equal("test-user", persisted.Catalog.Soulseek.Username);
        Assert.Equal("other-secret", persisted.Catalog.Spotify!.ClientSecret);
        using var json = await client.GetFromJsonAsync<JsonDocument>("/api/settings/soulseek/download-folder");
        Assert.Equal(Downloads, json!.RootElement.GetProperty("effectiveDownloadFolder").GetString());
        Assert.Equal(Music, json.RootElement.GetProperty("nextDownloadFolder").GetString());
        Assert.Equal(Music, json.RootElement.GetProperty("suggestedMusicFolder").GetString());
        Assert.True(json.RootElement.GetProperty("restartRequired").GetBoolean());
    }

    [Fact]
    public async Task Invalid_or_external_destinations_are_rejected_and_default_can_be_restored()
    {
        var client = _app.GetTestClient();
        foreach (var path in new[] { "relative/music", Path.Combine(_root, "does-not-exist") })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/settings/soulseek/download-folder", new { downloadFolder = path })).StatusCode);
        Assert.Equal(Downloads, _store.Current.Catalog!.Soulseek!.DownloadFolder);
        (await client.PutAsJsonAsync("/api/settings/soulseek/download-folder", new { downloadFolder = (string?)null })).EnsureSuccessStatusCode();
        Assert.Null(_store.Current.Catalog.Soulseek.DownloadFolder);
        _store.Update(s => s with { Catalog = s.Catalog! with { Soulseek = s.Catalog.Soulseek! with { ManageSlskd = false } } });
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/settings/soulseek/download-folder", new { downloadFolder = Music })).StatusCode);
    }

    [Fact]
    public async Task Completion_imports_active_folder_once_without_moving_same_named_files()
    {
        var nested = Directory.CreateDirectory(Path.Combine(Downloads, "Uploader")).FullName;
        var path = Path.Combine(nested, "Track.mp3");
        var unrelated = Path.Combine(Music, "Track.mp3");
        await File.WriteAllTextAsync(path, "download");
        await File.WriteAllTextAsync(unrelated, "keep me");
        var client = _app.GetTestClient();
        var transfers = await client.GetFromJsonAsync<TransferDto[]>("/api/soulseek/downloads");
        var scanId = Assert.Single(transfers!).ImportScanId;
        Assert.NotNull(scanId);
        var again = await client.GetFromJsonAsync<TransferDto[]>("/api/soulseek/downloads");
        Assert.Equal(scanId, Assert.Single(again!).ImportScanId);
        await using var scope = _app.Services.CreateAsyncScope();
        var job = Assert.Single(scope.ServiceProvider.GetRequiredService<WispDbContext>().ScanJobs);
        Assert.Equal(Downloads, job.FolderPath);
        Assert.Equal("download", await File.ReadAllTextAsync(path));
        Assert.Equal("keep me", await File.ReadAllTextAsync(unrelated));
        Assert.False(File.Exists(Path.Combine(Downloads, "Track.mp3")));
    }

    [Fact]
    public async Task Unknown_active_folder_retries_instead_of_marking_transfer_imported()
    {
        _daemon.Folder = null;
        var client = _app.GetTestClient();
        var first = await client.GetFromJsonAsync<TransferDto[]>("/api/soulseek/downloads");
        Assert.Null(Assert.Single(first!).ImportScanId);
        _daemon.Folder = Downloads;
        var second = await client.GetFromJsonAsync<TransferDto[]>("/api/soulseek/downloads");
        Assert.NotNull(Assert.Single(second!).ImportScanId);
    }

    private sealed class FakeSlskd : HttpMessageHandler, IHttpClientFactory
    {
        public string? Folder { get; set; }
        private readonly string _transferId = Guid.NewGuid().ToString();
        public HttpClient CreateClient(string name) => new(this, disposeHandler: false);
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            object body = request.RequestUri!.AbsolutePath.EndsWith("/options")
                ? new { directories = new { downloads = Folder } }
                : new[] { new { username = "uploader", directories = new[] { new { directory = "Uploader", files = new[] {
                    new { id = _transferId, filename = @"Uploader\Track.mp3", state = "Completed, Succeeded", size = 8, bytesTransferred = 8, percentComplete = 100 }
                } } } } };
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(body) });
        }
    }
}
