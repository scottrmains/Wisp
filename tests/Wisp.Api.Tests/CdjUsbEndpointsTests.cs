using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Wisp.Api.Usb;
using Wisp.Infrastructure.Usb;

namespace Wisp.Api.Tests;

public sealed class CdjUsbEndpointsTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Discovery_reports_incompatible_usb_or_actionable_error_without_a_profile(bool fails)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddSingleton<IUsbExportDevices>(new Devices(fails));
        builder.Services.AddSingleton<PioneerDeviceLibraryWriter>();
        builder.Services.AddSingleton<PioneerUsbExportService>();
        await using var app = builder.Build();
        app.MapCdjUsbDevices();
        await app.StartAsync();
        var response = await app.GetTestClient().GetAsync("/api/cdj-export/devices");
        if (fails)
        {
            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
            Assert.Contains("usb_detection_failed", await response.Content.ReadAsStringAsync());
        }
        else
        {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var devices = await response.Content.ReadFromJsonAsync<List<UsbExportDevice>>();
            var usb = Assert.Single(devices!);
            Assert.False(usb.CanExport);
            Assert.Contains("GPT", usb.CompatibilityProblem);
        }
    }

    private sealed class Devices(bool fails) : IUsbExportDevices
    {
        public Task<IReadOnlyList<UsbExportDevice>> ListAsync(CancellationToken ct) => fails ? throw new IOException("Test failure") :
            Task.FromResult<IReadOnlyList<UsbExportDevice>>([new("disk-4", "F:\\", "USB DRIVE", "Flash", 32000000000, 31000000000, "FAT32", "GPT", 2, false, false, "USB")]);
    }
}
