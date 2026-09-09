using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wisp.Api.MixPlans;
using Wisp.Core.MixPlans;
using Wisp.Core.Recommendations;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Persistence;
using Wisp.Infrastructure.Usb;

namespace Wisp.Api.Tests;

public sealed class MixPlanEndpointsTests : IAsyncLifetime
{
    private readonly SqliteConnection _connection = new("Data Source=:memory:");
    private WebApplication _app = null!;
    private Guid _planId;

    public async Task InitializeAsync()
    {
        await _connection.OpenAsync();
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddDbContext<WispDbContext>(options => options.UseSqlite(_connection));
        builder.Services.AddSingleton<UsbFileSync>();
        builder.Services.AddSingleton<PioneerDeviceLibraryWriter>();
        builder.Services.AddSingleton<PioneerUsbExportService>();
        builder.Services.AddSingleton<RecommendationService>();
        _app = builder.Build();
        _app.MapMixPlans();

        await using var scope = _app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        await db.Database.EnsureCreatedAsync();
        var track = new Track
        {
            Id = Guid.NewGuid(),
            FilePath = @"C:\music\Artist - Track.mp3",
            FileName = "Artist - Track.mp3",
            FileHash = "hash",
            Artist = "Artist",
            Title = "Track",
            Duration = TimeSpan.FromSeconds(180),
            AddedAt = DateTime.UtcNow,
        };
        _planId = Guid.NewGuid();
        db.MixPlans.Add(new MixPlan
        {
            Id = _planId,
            Name = "Warmup",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            Tracks = [new MixPlanTrack { Id = Guid.NewGuid(), TrackId = track.Id, Order = 1, Track = track }],
        });
        await db.SaveChangesAsync();
        await _app.StartAsync();
    }

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        await _connection.DisposeAsync();
    }

    [Fact]
    public async Task M3u_export_is_a_download_with_the_expected_track_path()
    {
        var response = await _app.GetTestClient().GetAsync($"/api/mix-plans/{_planId}/export?format=m3u");

        response.EnsureSuccessStatusCode();
        Assert.Equal("attachment; filename=\"Warmup.m3u8\"", response.Content.Headers.ContentDisposition!.ToString());
        var text = await response.Content.ReadAsStringAsync();
        Assert.Contains("#EXTM3U", text);
        Assert.Contains(@"C:\music\Artist - Track.mp3", text);
    }
}
