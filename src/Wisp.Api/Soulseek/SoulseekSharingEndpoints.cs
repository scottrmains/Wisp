using System.Text.Json;
using Wisp.Api.Settings;
using Wisp.Infrastructure;
using Wisp.Infrastructure.ExternalCatalog.Soulseek;

namespace Wisp.Api.Soulseek;

public static class SoulseekSharingEndpoints
{
    public static string Signature(SoulseekSharingSettings settings) => JsonSerializer.Serialize(settings);

    public static void MapSoulseekSharing(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/soulseek/sharing", (WispSettingsStore store, SoulseekOptions options) =>
        {
            var saved = store.Current.SoulseekSharing ?? new();
            return Results.Ok(new { settings = saved, canConfigure = options.OwnsDaemon && options.ManageSlskd,
                restartRequired = options.OwnsDaemon && Signature(saved) != options.ActiveSharingSignature });
        });
        app.MapPut("/api/soulseek/sharing", (SoulseekSharingSettings body, WispSettingsStore store, SoulseekOptions options) =>
        {
            if (!options.OwnsDaemon || !options.ManageSlskd) return Results.BadRequest(new { message = "Your external slskd manages sharing. Configure its shared folders and limits there." });
            if (body.UploadSlots is < 1 or > 20 || body.UploadSpeedLimit is < 1 or > 102400 || (body.Folders?.Length ?? 0) > 20)
                return Results.BadRequest(new { message = "Choose 1–20 upload slots, 1–102400 KiB/s and at most 20 folders." });
            try
            {
                var folders = (body.Folders ?? []).Select(folder =>
                {
                    if (string.IsNullOrWhiteSpace(folder) || !Path.IsPathFullyQualified(folder) || !Directory.Exists(folder))
                        throw new ArgumentException("Choose existing folders using their full paths.");
                    var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(folder));
                    if (full.Equals(Path.TrimEndingDirectorySeparator(Path.GetPathRoot(full)!), StringComparison.OrdinalIgnoreCase)
                        || IsWithin(full, WispPaths.AppDataDir)
                        || IsWithin(full, Path.Combine(WispPaths.SlskdDir, "incomplete"))
                        || (store.Current.RecordingFolder is { } recordings && IsWithin(full, recordings)))
                        throw new ArgumentException("Do not share a drive root, WISP profile, incomplete downloads or private recordings folder.");
                    return full;
                }).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                if (body.Enabled && folders.Length == 0) throw new ArgumentException("Choose at least one folder before enabling sharing.");
                store.Update(s => s with { SoulseekSharing = body with { Folders = folders } });
                return Results.Ok(new { message = "Saved. Restart WISP to apply sharing folders and upload limits. The running connection is unchanged." });
            }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException or IOException)
            { return Results.BadRequest(new { message = ex.Message }); }
        });
        app.MapGet("/api/soulseek/shares", async (SoulseekClient client, CancellationToken ct) =>
        {
            try { return Results.Ok(await client.ListSharesAsync(ct)); }
            catch (Exception ex) when (IsConnectionError(ex)) { return Results.BadRequest(new { message = ex.Message }); }
        });
        app.MapGet("/api/soulseek/shares/status", async (SoulseekClient client, CancellationToken ct) =>
        {
            try { return Results.Ok(await client.GetShareScanAsync(ct)); }
            catch (Exception ex) when (IsConnectionError(ex)) { return Results.BadRequest(new { message = ex.Message }); }
        });
        app.MapPost("/api/soulseek/shares/rescan", async (SoulseekClient client, CancellationToken ct) =>
        {
            try { await client.RescanSharesAsync(ct); return Results.NoContent(); }
            catch (Exception ex) when (IsConnectionError(ex)) { return Results.BadRequest(new { message = ex.Message }); }
        });
        app.MapGet("/api/soulseek/uploads", async (SoulseekClient client, CancellationToken ct) =>
        {
            try { return Results.Ok((await client.ListUploadsAsync(ct)).Select(TransferDto.From)); }
            catch (Exception ex) when (IsConnectionError(ex)) { return Results.BadRequest(new { message = ex.Message }); }
        });
        app.MapPost("/api/soulseek/uploads/cancel", async (TransferActionRequest body, SoulseekClient client, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(body.Username) || !Guid.TryParse(body.Id, out _))
                return Results.BadRequest(new { message = "A transfer username and valid ID are required." });
            try
            {
                if (!(await client.ListUploadsAsync(ct)).Any(t => t.Id == body.Id && t.Username == body.Username && !SoulseekTransferState.IsFinished(t.State)))
                    return Results.Conflict(new { message = "This upload is no longer active. Refresh the list." });
                await client.CancelUploadAsync(body.Username, body.Id, ct);
                return Results.NoContent();
            }
            catch (Exception ex) when (IsConnectionError(ex)) { return Results.BadRequest(new { message = ex.Message }); }
        });
    }

    private static bool IsConnectionError(Exception ex) => ex is SoulseekNotConfiguredException or SoulseekUnreachableException or InvalidOperationException;
    private static bool IsWithin(string path, string folder) => path.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(folder)), StringComparison.OrdinalIgnoreCase)
        || path.StartsWith(Path.TrimEndingDirectorySeparator(Path.GetFullPath(folder)) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
}
