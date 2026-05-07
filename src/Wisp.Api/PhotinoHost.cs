using System.Text.Json;
using Photino.NET;
using Serilog;
using Wisp.Api.Settings;

namespace Wisp.Api;

public static class PhotinoHost
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static void Run(string url, WispSettingsStore settings)
    {
        var saved = settings.Current.Window;

        var window = new PhotinoWindow()
            .SetTitle("Wisp")
            .SetUseOsDefaultSize(false)
            .SetSize(saved?.Width ?? 1400, saved?.Height ?? 900)
            .SetResizable(true);

        if (saved is { X: { } x, Y: { } y })
            window = window.SetLeft(x).SetTop(y);
        else
            window = window.Center();

        window.RegisterWebMessageReceivedHandler((sender, message) =>
        {
            var win = (PhotinoWindow)sender!;
            HandleMessage(win, message);
        });

        window.Load(new Uri(url));
        window.WaitForClose();

        try
        {
            settings.Update(s => s with
            {
                Window = new WindowState(window.Width, window.Height, window.Left, window.Top)
            });
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to persist window state");
        }
    }

    private static void HandleMessage(PhotinoWindow window, string raw)
    {
        BridgeRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<BridgeRequest>(raw, Json);
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Bridge: malformed message {Raw}", raw);
            return;
        }

        if (request is null || string.IsNullOrEmpty(request.Method))
            return;

        try
        {
            var result = Dispatch(window, request);
            Reply(window, request.Id, result, error: null);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Bridge: handler threw for {Method}", request.Method);
            Reply(window, request.Id, result: null, error: ex.Message);
        }
    }

    private static object? Dispatch(PhotinoWindow window, BridgeRequest request) => request.Method switch
    {
        "pickFolder" => PickFolder(window, request.Args),
        "ping" => new { pong = DateTimeOffset.UtcNow },
        _ => throw new InvalidOperationException($"Unknown bridge method '{request.Method}'")
    };

    private static object? PickFolder(PhotinoWindow window, JsonElement? args)
    {
        var title = args?.TryGetProperty("title", out var t) == true ? t.GetString() : "Select a music folder";
        var initial = args?.TryGetProperty("initialPath", out var p) == true ? p.GetString() : null;

        var picked = window.ShowOpenFolder(title ?? "Select folder", defaultPath: initial, multiSelect: false);
        var path = picked?.FirstOrDefault();
        return new { path };
    }

    private static void Reply(PhotinoWindow window, string? id, object? result, string? error)
    {
        var payload = JsonSerializer.Serialize(new BridgeResponse(id, result, error), Json);
        window.SendWebMessage(payload);
    }

    private sealed record BridgeRequest(string? Id, string Method, JsonElement? Args);
    private sealed record BridgeResponse(string? Id, object? Result, string? Error);
}
