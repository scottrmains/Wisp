using Wisp.Infrastructure.Usb;

namespace Wisp.Api.Usb;

public static class CdjUsbEndpoints
{
    public static IEndpointRouteBuilder MapCdjUsbDevices(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/cdj-export/devices", async (PioneerUsbExportService exporter, CancellationToken ct) =>
        {
            try { return Results.Ok(await exporter.ListUsbDevicesAsync(ct)); }
            catch (Exception ex) when (ex is IOException or System.ComponentModel.Win32Exception or System.Text.Json.JsonException)
            {
                return Results.Json(new { code = "usb_detection_failed", message = "Windows could not inspect connected USB devices. Reconnect the USB and refresh. No drive was changed." }, statusCode: 503);
            }
        });
        return app;
    }
}
