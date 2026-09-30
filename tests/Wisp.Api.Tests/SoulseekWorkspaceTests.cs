using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wisp.Api.Settings;
using Wisp.Api.Soulseek;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.ExternalCatalog.Soulseek;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;
using YamlDotNet.RepresentationModel;

namespace Wisp.Api.Tests;

[Collection("Soulseek endpoints")]
public sealed class SoulseekWorkspaceTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wisp-soulseek-" + Guid.NewGuid().ToString("N"));
    private readonly Daemon _daemon = new();
    private WebApplication _app = null!;
    private SoulseekOptions _options = null!;
    private WispSettingsStore _settings = null!;
    private HttpClient Client => _app.GetTestClient();

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(_root);
        _daemon.Folder = _root;
        _settings = new(Path.Combine(_root, "config.json"));
        _settings.Update(s => s with { RecordingFolder = Path.Combine(_root, "Private"), Catalog = new() { Soulseek = new("http://fake-slskd", "fake-key") } });
        _options = new() { Url = "http://fake-slskd", ApiKey = "fake-key", OwnsDaemon = true, ActiveSharingSignature = SoulseekSharingEndpoints.Signature(new()) };
        await Start();
    }

    private async Task Start()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddDbContext<WispDbContext>(o => o.UseSqlite($"Data Source={Path.Combine(_root, "isolated.db")};Pooling=False"));
        builder.Services.AddSingleton(_settings);
        builder.Services.AddSingleton(_options);
        builder.Services.AddSingleton<IHttpClientFactory>(_daemon);
        builder.Services.AddSingleton<SoulseekClient>();
        builder.Services.AddSingleton<ScanQueue>();
        builder.Services.AddHostedService<SoulseekImportRecovery>();
        _app = builder.Build();
        _app.MapSoulseek();
        _app.MapSoulseekSharing();
        await using (var scope = _app.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<WispDbContext>().Database.MigrateAsync();
        await _app.StartAsync();
    }

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        Directory.Delete(_root, true);
    }

    [Theory]
    [InlineData(true, true, false)]
    [InlineData(true, false, false)]
    [InlineData(false, false, true)]
    public async Task Connection_reports_network_login_not_just_daemon_availability(bool connected, bool loggedIn, bool transitioning)
    {
        _daemon.Connected = connected; _daemon.LoggedIn = loggedIn; _daemon.Transitioning = transitioning;
        var status = await Client.GetFromJsonAsync<SoulseekConnection>("/api/soulseek/connection");
        Assert.True(status!.DaemonAvailable);
        Assert.Equal(connected, status.IsConnected); Assert.Equal(loggedIn, status.IsLoggedIn); Assert.Equal(transitioning, status.IsTransitioning);
    }

    [Fact]
    public async Task Unreachable_connection_is_a_readable_status_and_reconnect_errors_are_not_hidden()
    {
        _daemon.Offline = true;
        Assert.False((await Client.GetFromJsonAsync<SoulseekConnection>("/api/soulseek/connection"))!.DaemonAvailable);
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.PostAsync("/api/soulseek/reconnect", null)).StatusCode);
    }

    [Fact]
    public async Task Search_lifecycle_uses_real_stop_and_delete_and_reconnect()
    {
        var response = await Client.PostAsJsonAsync("/api/soulseek/searches", new { query = "  Olive alone  " });
        response.EnsureSuccessStatusCode();
        var search = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        Assert.Contains(_daemon.Requests, r => r.Path == "/api/v0/searches" && r.Body!.Contains("Olive alone") && r.Body.Contains("1000"));
        Assert.Equal(HttpStatusCode.NoContent, (await Client.PostAsync($"/api/soulseek/searches/{search}/stop", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Client.DeleteAsync($"/api/soulseek/searches/{search}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Client.PostAsync("/api/soulseek/reconnect", null)).StatusCode);
        Assert.Contains(_daemon.Requests, r => r.Method == "PUT" && r.Path == $"/api/v0/searches/{search}");
        Assert.Contains(_daemon.Requests, r => r.Method == "DELETE" && r.Path == $"/api/v0/searches/{search}");
        Assert.Contains(_daemon.Requests, r => r.Method == "PUT" && r.Path == "/api/v0/server");
    }

    [Fact]
    public async Task Retry_download_validates_target_and_never_requeues_successful_or_active_files()
    {
        _daemon.State = "Completed, Errored";
        Assert.Equal(HttpStatusCode.NoContent, (await Action("retry")).StatusCode);
        Assert.Contains(_daemon.Requests, r => r.Method == "POST" && r.Path.Contains("/downloads/"));
        _daemon.State = "InProgress";
        Assert.Equal(HttpStatusCode.BadRequest, (await Action("retry")).StatusCode);
        _daemon.State = "Completed, Succeeded";
        Assert.Equal(HttpStatusCode.BadRequest, (await Action("retry")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.PostAsJsonAsync("/api/soulseek/downloads/retry", new { username = "wrong", id = _daemon.Id })).StatusCode);
    }

    [Fact]
    public async Task Http_201_with_no_enqueued_file_is_not_reported_as_success()
    {
        _daemon.RefuseAcknowledgement = true;
        var response = await Client.PostAsJsonAsync("/api/soulseek/downloads", new { username = "uploader", filename = "Folder\\track.mp3", size = 4000 });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("did not queue", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Generated_config_is_accepted_by_bundled_slskd_without_connecting()
    {
        var binary = Environment.GetEnvironmentVariable("WISP_TEST_SLSKD");
        if (string.IsNullOrWhiteSpace(binary)) return; // optional offline binary validation
        var appDir = Directory.CreateDirectory(Path.Combine(_root, "daemon")).FullName;
        var incomplete = Directory.CreateDirectory(Path.Combine(_root, "incomplete")).FullName;
        var config = Path.Combine(appDir, "slskd.yml");
        await File.WriteAllTextAsync(config, SlskdConfig.GenerateSlskdYaml("test-api-key-long-enough", "test-dj", "fake-password", 19591,
            _root, incomplete, new(true, [_root], 2, 128), Path.Combine(_root, "Private")));
        using var process = new System.Diagnostics.Process
        {
            StartInfo = new(binary) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false,
                CreateNoWindow = true, ArgumentList = { "--app-dir", appDir, "--config", config, "--no-start", "--no-connect", "--no-logo" } },
        };
        process.Start();
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        try { await process.WaitForExitAsync(timeout.Token); }
        catch { process.Kill(entireProcessTree: true); throw; }
        Assert.True(process.ExitCode == 0, (await stdout) + (await stderr));
    }

    [Fact]
    public async Task Import_receipt_survives_restart_and_clear_does_not_remove_music()
    {
        var audio = Path.Combine(_root, "keep.mp3");
        await File.WriteAllTextAsync(audio, "unchanged audio");
        var first = await Downloads();
        await using (var scope = _app.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
            (await db.ScanJobs.SingleAsync()).Status = ScanStatus.Completed;
            await db.SaveChangesAsync();
        }
        await _app.DisposeAsync(); await Start();
        var second = await Downloads();
        Assert.Equal(first.ImportScanId, second.ImportScanId);
        Assert.Equal("Completed", second.ImportStatus);
        await using (var scope = _app.Services.CreateAsyncScope())
            Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<WispDbContext>().ScanJobs.CountAsync());
        var clear = await Action("clear"); clear.EnsureSuccessStatusCode();
        Assert.Single((await clear.Content.ReadFromJsonAsync<ClearTransfersResult>())!.ClearedIds);
        Assert.Equal("unchanged audio", await File.ReadAllTextAsync(audio));
    }

    [Fact]
    public async Task Restart_makes_interrupted_import_retryable_without_requeuing_download()
    {
        var first = await Downloads();
        Assert.Equal("Pending", first.ImportStatus);
        await _app.DisposeAsync(); await Start();
        var recovered = await Downloads();
        Assert.Equal("Failed", recovered.ImportStatus);
        Assert.Contains("WISP closed", recovered.ImportError);
        Assert.Equal(HttpStatusCode.NoContent, (await Action("import")).StatusCode);
        var retry = await Downloads();
        Assert.NotEqual(first.ImportScanId, retry.ImportScanId);
        Assert.Equal("Pending", retry.ImportStatus);
        Assert.Equal(HttpStatusCode.BadRequest, (await Action("import")).StatusCode);
        Assert.DoesNotContain(_daemon.Requests, r => r.Method == "POST" && r.Path.Contains("/downloads/"));
    }

    [Fact]
    public async Task Import_receipts_are_scoped_to_the_daemon()
    {
        var first = await Downloads();
        _options.Url = "http://different-slskd";
        var second = await Downloads();
        Assert.NotEqual(first.ImportScanId, second.ImportScanId);
    }

    [Fact]
    public async Task Sharing_is_opt_in_persists_without_replacing_login_and_requires_restart()
    {
        var initial = await Client.GetFromJsonAsync<JsonElement>("/api/soulseek/sharing");
        Assert.False(initial.GetProperty("settings").GetProperty("enabled").GetBoolean());
        var saved = new SoulseekSharingSettings(true, [_root], 3, 256);
        var response = await Client.PutAsJsonAsync("/api/soulseek/sharing", saved); response.EnsureSuccessStatusCode();
        Assert.Equal(saved.Folders, _settings.Current.SoulseekSharing!.Folders);
        Assert.Equal("fake-key", _settings.Current.Catalog!.Soulseek!.ApiKey);
        var next = await Client.GetFromJsonAsync<JsonElement>("/api/soulseek/sharing");
        Assert.True(next.GetProperty("restartRequired").GetBoolean());
        Assert.DoesNotContain(_daemon.Requests, r => r.Method != "GET");
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("relative")]
    [InlineData("root")]
    [InlineData("recordings")]
    public async Task Sharing_rejects_missing_relative_drive_root_and_private_recordings(string kind)
    {
        var recordings = Directory.CreateDirectory(Path.Combine(_root, "Private")).FullName;
        var path = kind switch { "missing" => Path.Combine(_root, "missing"), "relative" => ".", "root" => Path.GetPathRoot(_root)!, _ => recordings };
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.PutAsJsonAsync("/api/soulseek/sharing", new SoulseekSharingSettings(true, [path]))).StatusCode);
        Assert.Null(_settings.Current.SoulseekSharing);
    }

    [Fact]
    public async Task External_daemon_shares_are_readable_but_its_config_is_not_overwritten()
    {
        _options.OwnsDaemon = false;
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.PutAsJsonAsync("/api/soulseek/sharing", new SoulseekSharingSettings(true, [_root]))).StatusCode);
        var shares = await Client.GetFromJsonAsync<SoulseekShare[]>("/api/soulseek/shares");
        Assert.Equal("Music 1", Assert.Single(shares!).Alias);
        Assert.Equal(HttpStatusCode.NoContent, (await Client.PostAsync("/api/soulseek/shares/rescan", null)).StatusCode);
        Assert.Null(_settings.Current.SoulseekSharing);
    }

    [Fact]
    public async Task Uploads_report_speed_queue_and_error_and_cancel_exact_active_target()
    {
        var uploads = await Client.GetFromJsonAsync<TransferDto[]>("/api/soulseek/uploads");
        var upload = Assert.Single(uploads!);
        Assert.Equal(2048, upload.AverageSpeed); Assert.Equal(2, upload.PlaceInQueue);
        Assert.Equal(HttpStatusCode.NoContent, (await Client.PostAsJsonAsync("/api/soulseek/uploads/cancel", new { username = "uploader", id = _daemon.Id })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Client.PostAsJsonAsync("/api/soulseek/uploads/cancel", new { username = "other", id = _daemon.Id })).StatusCode);
    }

    [Fact]
    public void Generated_yaml_preserves_windows_paths_and_apostrophes_and_filters_private_files()
    {
        var yaml = SlskdConfig.GenerateSlskdYaml("fake", "test", "fake", 5030, @"D:\Music", @"D:\Incomplete",
            new(true, [@"D:\DJ's Music"], 2, 128), @"D:\Private");
        var stream = new YamlStream(); stream.Load(new StringReader(yaml));
        var root = (YamlMappingNode)stream.Documents.Single().RootNode;
        var directories = (YamlMappingNode)root.Children[new YamlScalarNode("directories")];
        Assert.Equal(@"D:\Music", ((YamlScalarNode)directories.Children[new YamlScalarNode("downloads")]).Value);
        var shares = (YamlMappingNode)root.Children[new YamlScalarNode("shares")];
        var paths = ((YamlSequenceNode)shares.Children[new YamlScalarNode("directories")]).Children.Select(x => ((YamlScalarNode)x).Value).ToArray();
        Assert.Contains(@"[Music 1]D:\DJ's Music", paths); Assert.Contains(@"!D:\Private", paths);
        var filters = ((YamlSequenceNode)shares.Children[new YamlScalarNode("filters")]).Children.Select(x => new System.Text.RegularExpressions.Regex(((YamlScalarNode)x).Value!)).ToArray();
        foreach (var privateFile in new[] { @"D:\Music\track.wav.wisp-id.json", @"D:\Music\Mixes\mix.mp3", @"D:\Music\Readme.txt", @"D:\Music\.wisp-identity-temp\copy.aiff", @"D:\Music\WISP Recordings\mix.wav" })
            Assert.Contains(filters, filter => filter.IsMatch(privateFile));
        Assert.DoesNotContain(filters, filter => filter.IsMatch(@"D:\Music\song.aiff"));
        // slskd also runs these regexes over directories. Normal music folders
        // (including dotted label names) must survive or nothing can be shared.
        Assert.DoesNotContain(filters, filter => filter.IsMatch(@"D:\Music\Label.v1"));
        Assert.DoesNotContain(filters, filter => filter.IsMatch(@"D:\Music"));
        var disabled = SlskdConfig.GenerateSlskdYaml("fake", "test", "fake", 5030, @"D:\Music", @"D:\Incomplete");
        Assert.Contains("directories: []", disabled);
    }

    private async Task<TransferDto> Downloads() => Assert.Single((await Client.GetFromJsonAsync<TransferDto[]>("/api/soulseek/downloads"))!);
    private Task<HttpResponseMessage> Action(string action) => Client.PostAsJsonAsync($"/api/soulseek/downloads/{action}", new { username = "uploader", id = _daemon.Id });

    private sealed record Request(string Method, string Path, string? Body);
    private sealed class Daemon : HttpMessageHandler, IHttpClientFactory
    {
        public string Id = Guid.NewGuid().ToString();
        public string Folder = "";
        public string State = "Completed, Succeeded";
        public bool Connected = true, LoggedIn = true, Transitioning, Offline, RefuseAcknowledgement;
        public List<Request> Requests = [];
        public HttpClient CreateClient(string name) => new(this, false);
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            if (Offline) throw new HttpRequestException("Test daemon offline");
            var path = request.RequestUri!.AbsolutePath;
            Requests.Add(new(request.Method.Method, path, request.Content is null ? null : await request.Content.ReadAsStringAsync(ct)));
            if (RefuseAcknowledgement && request.Method == HttpMethod.Post && path.Contains("/downloads/"))
                return new(HttpStatusCode.Created) { Content = JsonContent.Create(new { enqueued = Array.Empty<object>(), failed = new[] { "Folder\\track.mp3" } }) };
            if (request.Method != HttpMethod.Get)
                return new(HttpStatusCode.OK) { Content = JsonContent.Create(path.EndsWith("/searches") ? new { id = Guid.NewGuid().ToString() } : (object)new { ok = true }) };
            object response = path switch
            {
                "/api/v0/server" => new { isConnected = Connected, isLoggedIn = LoggedIn, isTransitioning = Transitioning, username = "test-dj" },
                "/api/v0/options" => new { directories = new { downloads = Folder } },
                "/api/v0/application" => new { shares = new { ready = true, scanning = false, scanPending = false, files = 7 } },
                "/api/v0/shares" => new Dictionary<string, object[]> { ["local"] = [new { id = "share-1", alias = "Music 1", localPath = Folder, isExcluded = false, files = 7 }] },
                _ => new[] { new { username = "uploader", directories = new[] { new { files = new[] {
                    new { id = Id, filename = "Folder\\track.mp3", size = 4000, bytesTransferred = 2000,
                        state = path.EndsWith("/uploads") ? "InProgress" : State, averageSpeed = 2048, placeInQueue = 2, percentComplete = 50 }
                } } } } },
            };
            return new(HttpStatusCode.OK) { Content = JsonContent.Create(response) };
        }
    }
}
