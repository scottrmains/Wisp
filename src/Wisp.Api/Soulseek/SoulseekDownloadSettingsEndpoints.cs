using Microsoft.EntityFrameworkCore;
using Wisp.Api.Settings;
using Wisp.Infrastructure;
using Wisp.Infrastructure.ExternalCatalog.Soulseek;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Soulseek;

public static class SoulseekDownloadSettingsEndpoints
{
    public static void MapSoulseekDownloadSettings(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/settings/soulseek/download-folder", async (
            WispSettingsStore store, SoulseekClient client, SoulseekOptions options, WispDbContext db, CancellationToken ct) =>
        {
            var saved = store.Current.Catalog?.Soulseek;
            var active = await client.GetEffectiveDownloadFolderAsync(ct) ?? options.ActiveDownloadFolder;
            var next = saved?.DownloadFolder ?? Path.Combine(WispPaths.SlskdDir, "downloads");
            var suggested = store.Current.LastFolder ?? await db.ScanJobs.AsNoTracking()
                .Where(s => s.Status == Wisp.Core.Tracks.ScanStatus.Completed && !s.FolderPath.StartsWith(WispPaths.AppDataDir))
                .OrderByDescending(s => s.StartedAt).Select(s => s.FolderPath).FirstOrDefaultAsync(ct);
            return Results.Ok(new
            {
                downloadFolder = saved?.DownloadFolder,
                effectiveDownloadFolder = active,
                nextDownloadFolder = next,
                suggestedMusicFolder = suggested,
                manageSlskd = saved?.ManageSlskd ?? true,
                restartRequired = active is not null && !SameFolder(active, next),
            });
        });

        app.MapPut("/api/settings/soulseek/download-folder", (DownloadFolderRequest body, WispSettingsStore store) =>
        {
            if (store.Current.Catalog?.Soulseek?.ManageSlskd == false)
                return Results.BadRequest(new { code = "external_slskd", message = "Change the download directory in your external slskd configuration. Wisp reads its active folder automatically." });
            var folder = string.IsNullOrWhiteSpace(body.DownloadFolder) ? null : body.DownloadFolder.Trim();
            if (folder is not null)
            {
                try
                {
                    if (!Path.IsPathFullyQualified(folder) || !Directory.Exists(folder))
                        return Results.BadRequest(new { code = "invalid_folder", message = "Choose an existing folder using its full path, for example D:\\Music." });
                    folder = Path.GetFullPath(folder);
                }
                catch (Exception ex) when (ex is ArgumentException or NotSupportedException or IOException)
                {
                    return Results.BadRequest(new { code = "invalid_folder", message = "That folder path is not valid." });
                }
            }
            // Change only the folder. Never clear login details, restart active
            // transfers, move existing files, or redirect the running importer.
            store.Update(s => s with
            {
                Catalog = (s.Catalog ?? new CatalogCredentials()) with
                {
                    Soulseek = (s.Catalog?.Soulseek ?? new SoulseekCredentials("", "")) with { DownloadFolder = folder },
                },
            });
            return Results.Ok(new { downloadFolder = folder, message = "Saved. Restart Wisp to use this folder for future downloads. Existing files stay where they are." });
        });
    }

    private static bool SameFolder(string a, string b) => string.Equals(
        Path.TrimEndingDirectorySeparator(a), Path.TrimEndingDirectorySeparator(b), StringComparison.OrdinalIgnoreCase);
}

public sealed record DownloadFolderRequest(string? DownloadFolder);
