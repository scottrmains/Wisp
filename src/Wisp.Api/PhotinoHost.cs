using System.Text.Json;
using Photino.NET;
using Serilog;
using Wisp.Api.Settings;

namespace Wisp.Api;

public static class PhotinoHost
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private const int MinWidth = 800;
    private const int MinHeight = 600;
    private const int DefaultWidth = 1400;
    private const int DefaultHeight = 900;

    public static void Run(string url, WispSettingsStore settings, bool devToolsEnabled = false)
    {
        var saved = settings.Current.Window;

        // Defend against corrupt persisted state — if a previous run closed in a
        // bad state (e.g. content area collapsed to title bar only), do not honour it.
        var width = Math.Max(saved?.Width ?? DefaultWidth, MinWidth);
        var height = Math.Max(saved?.Height ?? DefaultHeight, MinHeight);

        Log.Information("Photino: window {Width}x{Height} (saved: {SavedW}x{SavedH})",
            width, height, saved?.Width, saved?.Height);

        var window = new PhotinoWindow()
            .SetTitle("Wisp")
            .SetUseOsDefaultSize(false)
            .SetSize(width, height)
            .SetResizable(true)
            .SetContextMenuEnabled(devToolsEnabled)
            .SetDevToolsEnabled(devToolsEnabled);

        if (saved is { X: { } x, Y: { } y } && IsReasonablePosition(x, y))
            window = window.SetLeft(x).SetTop(y);
        else
            window = window.Center();

        window.RegisterWebMessageReceivedHandler((sender, message) =>
        {
            var win = (PhotinoWindow)sender!;
            HandleMessage(win, message);
        });

        Log.Information("Photino: loading {Url}", url);
        window.Load(new Uri(url));
        window.WaitForClose();
        Log.Information("Photino: window closed");

        try
        {
            var w = window.Width;
            var h = window.Height;

            if (w >= MinWidth && h >= MinHeight)
            {
                settings.Update(s => s with
                {
                    Window = new WindowState(w, h, window.Left, window.Top)
                });
            }
            else
            {
                Log.Warning("Photino: skipping window-state persist (size {W}x{H} below minimum)", w, h);
            }
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to persist window state");
        }
    }

    private static bool IsReasonablePosition(int x, int y)
        => x > -10000 && x < 10000 && y > -10000 && y < 10000;

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
        "openInExplorer" => OpenInExplorer(request.Args),
        "openExternal" => OpenExternal(request.Args),
        "ping" => new { pong = DateTimeOffset.UtcNow },
        _ => throw new InvalidOperationException($"Unknown bridge method '{request.Method}'")
    };

    private static object? OpenInExplorer(JsonElement? args)
    {
        var path = args?.TryGetProperty("path", out var p) == true ? p.GetString() : null;
        if (string.IsNullOrWhiteSpace(path))
            throw new ArgumentException("path is required");

        if (!Directory.Exists(path) && !File.Exists(path))
            throw new DirectoryNotFoundException($"Path not found: {path}");

        // explorer.exe handles both folders and files (selects the file when given a file path).
        // For files we use /select, for folders we open them directly.
        var psi = File.Exists(path)
            ? new System.Diagnostics.ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = true }
            : new System.Diagnostics.ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true };

        System.Diagnostics.Process.Start(psi);
        return new { ok = true };
    }

    private static object? OpenExternal(JsonElement? args)
    {
        var url = args?.TryGetProperty("url", out var u) == true ? u.GetString() : null;
        if (string.IsNullOrWhiteSpace(url))
            throw new ArgumentException("url is required");

        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw new ArgumentException("Only http/https URLs are allowed.");

        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
        return new { ok = true };
    }

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
