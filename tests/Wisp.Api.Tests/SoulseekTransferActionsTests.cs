using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wisp.Api.Soulseek;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.ExternalCatalog.Soulseek;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Tests;

[Collection("Soulseek endpoints")]
public sealed class SoulseekTransferActionsTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wisp-transfers-" + Guid.NewGuid().ToString("N"));
    private readonly SqliteConnection _connection = new("Data Source=:memory:");
    private readonly FakeDaemon _daemon = new();
    private WebApplication _app = null!;

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(_root);
        _daemon.Folder = _root;
        await File.WriteAllTextAsync(Path.Combine(_root, "keep.mp3"), "downloaded file");
        await _connection.OpenAsync();
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddDbContext<WispDbContext>(o => o.UseSqlite(_connection));
        builder.Services.AddSingleton(new SoulseekOptions { Url = "http://fake-slskd", ApiKey = "test-key" });
        builder.Services.AddSingleton<IHttpClientFactory>(_daemon);
        builder.Services.AddSingleton<SoulseekClient>();
        builder.Services.AddSingleton<ScanQueue>();
        _app = builder.Build();
        _app.MapSoulseek();
        await using var scope = _app.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<WispDbContext>().Database.EnsureCreatedAsync();
        await _app.StartAsync();
    }

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        await _connection.DisposeAsync();
        Directory.Delete(_root, recursive: true);
    }

    [Theory]
    [InlineData("Queued, Remotely")]
    [InlineData("Queued, Locally")]
    [InlineData("InProgress")]
    public async Task Cancel_targets_the_exact_transfer_without_removing_history(string state)
    {
        var transfer = Add(state, "DJ + &?# name");
        var response = await Post("cancel", transfer);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var call = Assert.Single(_daemon.Deletes);
        Assert.Equal($"/api/v0/transfers/downloads/{Uri.EscapeDataString(transfer.Username)}/{transfer.Id}?remove=false", call);
        Assert.Equal("Completed, Cancelled", _daemon.Transfers.Single().State);
        Assert.Equal("downloaded file", await File.ReadAllTextAsync(Path.Combine(_root, "keep.mp3")));
    }

    [Theory]
    [InlineData("Completed, Succeeded")]
    [InlineData("Completed, Cancelled")]
    [InlineData("Errored")]
    public async Task Cancel_rejects_finished_transfers(string state)
    {
        Assert.Equal(HttpStatusCode.Conflict, (await Post("cancel", Add(state))).StatusCode);
        Assert.Empty(_daemon.Deletes);
    }

    [Fact]
    public async Task Clear_active_or_invalid_targets_never_cancels_anything()
    {
        var active = Add("InProgress");
        Assert.Equal(HttpStatusCode.Conflict, (await Post("clear", active)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Post("cancel", active with { Username = "someone else" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post("cancel", active with { Id = "../bad" })).StatusCode);
        Assert.Empty(_daemon.Deletes);
    }

    [Fact]
    public async Task Clear_finished_preserves_active_transfers_files_and_pending_imports()
    {
        var active = Add("Queued, Remotely");
        var done = Add("Completed, Succeeded");
        var failed = Add("Completed, Errored");
        var cancelled = Add("Completed, Cancelled");
        // Listing the successful transfer queues its import as in the real UI.
        var rows = await _app.GetTestClient().GetFromJsonAsync<TransferDto[]>("/api/soulseek/downloads");
        var scanId = rows!.Single(t => t.Id == done.Id).ImportScanId;
        Assert.NotNull(scanId);
        var first = await ClearAll();
        Assert.Equal(1, first.Skipped);
        Assert.Equal(new[] { failed.Id, cancelled.Id }, first.ClearedIds);
        Assert.Contains(_daemon.Transfers, t => t.Id == active.Id);
        Assert.Contains(_daemon.Transfers, t => t.Id == done.Id);

        await using var scope = _app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        var job = await db.ScanJobs.SingleAsync(s => s.Id == scanId);
        job.Status = ScanStatus.Completed;
        await db.SaveChangesAsync();
        Assert.Equal(done.Id, Assert.Single((await ClearAll()).ClearedIds));
        Assert.Equal(active.Id, Assert.Single(_daemon.Transfers).Id);
        Assert.All(_daemon.Deletes, path => Assert.EndsWith("?remove=true", path));
        Assert.Equal("downloaded file", await File.ReadAllTextAsync(Path.Combine(_root, "keep.mp3")));
        Assert.Empty((await ClearAll()).ClearedIds);
    }

    [Theory]
    [InlineData("Completed, TimedOut")]
    [InlineData("Completed, Rejected")]
    [InlineData("Aborted")]
    public async Task Individual_failed_records_can_be_cleared(string state)
    {
        var transfer = Add(state);
        var response = await Post("clear", transfer);
        var result = await response.Content.ReadFromJsonAsync<ClearTransfersResult>();
        Assert.Equal(transfer.Id, Assert.Single(result!.ClearedIds));
        Assert.Empty(_daemon.Transfers);
        Assert.Equal(HttpStatusCode.OK, (await Post("clear", transfer)).StatusCode);
    }

    [Fact]
    public async Task Partial_clear_failure_is_reported_and_record_remains_retryable()
    {
        var refused = Add("Completed, Errored");
        var cleared = Add("Completed, Cancelled");
        _daemon.RefuseId = refused.Id;
        var result = await ClearAll();
        Assert.Equal(cleared.Id, Assert.Single(result.ClearedIds));
        Assert.Contains("HTTP 403", Assert.Single(result.Errors));
        Assert.Equal(refused.Id, Assert.Single(_daemon.Transfers).Id);
    }

    [Fact]
    public async Task Unreachable_daemon_does_not_report_cancellation_success()
    {
        var transfer = Add("InProgress");
        _daemon.Unreachable = true;
        var response = await Post("cancel", transfer);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Could not reach slskd", await response.Content.ReadAsStringAsync());
        Assert.Empty(_daemon.Deletes);
    }

    private RemoteTransfer Add(string state, string username = "uploader")
    {
        var transfer = new RemoteTransfer(Guid.NewGuid().ToString(), username, "keep.mp3", state);
        _daemon.Transfers.Add(transfer);
        return transfer;
    }
    private Task<HttpResponseMessage> Post(string action, RemoteTransfer transfer) =>
        _app.GetTestClient().PostAsJsonAsync($"/api/soulseek/downloads/{action}", new { transfer.Id, transfer.Username });
    private async Task<ClearTransfersResult> ClearAll()
    {
        var response = await _app.GetTestClient().PostAsJsonAsync("/api/soulseek/downloads/clear", new { });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ClearTransfersResult>())!;
    }
    private sealed record RemoteTransfer(string Id, string Username, string Filename, string State);
    private sealed class FakeDaemon : HttpMessageHandler, IHttpClientFactory
    {
        public string Folder = "";
        public bool Unreachable;
        public string? RefuseId;
        public List<RemoteTransfer> Transfers = [];
        public List<string> Deletes = [];
        public HttpClient CreateClient(string name) => new(this, disposeHandler: false);
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            if (Unreachable) throw new HttpRequestException("Test daemon offline");
            var uri = request.RequestUri!;
            if (request.Method == HttpMethod.Delete)
            {
                Deletes.Add(uri.PathAndQuery);
                var id = uri.Segments.Last();
                if (id == RefuseId) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Forbidden));
                var index = Transfers.FindIndex(t => t.Id == id);
                if (index < 0) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
                if (uri.Query == "?remove=true") Transfers.RemoveAt(index);
                else Transfers[index] = Transfers[index] with { State = "Completed, Cancelled" };
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NoContent));
            }
            object body = uri.AbsolutePath.EndsWith("/options") ? new { directories = new { downloads = Folder } }
                : Transfers.GroupBy(t => t.Username).Select(g => new { username = g.Key,
                    directories = new[] { new { directory = "", files = g.Select(t => new { id = t.Id, filename = t.Filename, state = t.State }) } } }).ToArray();
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(body) });
        }
    }
}
