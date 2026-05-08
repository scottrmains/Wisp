using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using Wisp.Api.Settings;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.ExternalCatalog.Soulseek;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Soulseek;

public static class SoulseekEndpoints
{
    /// Tracks transfers we've already auto-imported so a single completion only re-scans once.
    private static readonly ConcurrentDictionary<string, byte> _autoImported = new();

    public static IEndpointRouteBuilder MapSoulseek(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/soulseek/test", TestConnection);
        app.MapPost("/api/soulseek/searches", StartSearch);
        app.MapGet("/api/soulseek/searches/{id}", GetSearch);
        app.MapPost("/api/soulseek/downloads", QueueDownload);
        app.MapGet("/api/soulseek/downloads", ListDownloads);
        return app;
    }

    private static async Task<IResult> TestConnection(SoulseekClient client, CancellationToken ct)
    {
        var error = await client.TestConnectionAsync(ct);
        return error is null
            ? Results.Ok(new { ok = true })
            : Results.BadRequest(new { ok = false, message = error });
    }

    private static async Task<IResult> StartSearch(StartSearchRequest body, SoulseekClient client, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Query))
            return Results.BadRequest(new { code = "query_required", message = "Query is required." });
        try
        {
            var id = await client.StartSearchAsync(body.Query.Trim(), fileLimit: 200, ct);
            return Results.Ok(new { id });
        }
        catch (SoulseekNotConfiguredException)
        {
            return Results.BadRequest(new { code = "soulseek_unconfigured", message = "slskd URL + API key not set." });
        }
        catch (SoulseekUnreachableException ex)
        {
            return Results.BadRequest(new { code = "soulseek_unreachable", message = ex.Message });
        }
    }

    private static async Task<IResult> GetSearch(string id, SoulseekClient client, CancellationToken ct)
    {
        try
        {
            var result = await client.GetSearchAsync(id, ct);
            return Results.Ok(new SearchResultDto(
                result.Id, result.IsComplete, result.ResponseCount,
                result.Hits.Select(SearchHitDto.From).ToList()));
        }
        catch (SoulseekNotConfiguredException)
        {
            return Results.BadRequest(new { code = "soulseek_unconfigured", message = "slskd URL + API key not set." });
        }
        catch (SoulseekUnreachableException ex)
        {
            return Results.BadRequest(new { code = "soulseek_unreachable", message = ex.Message });
        }
    }

    private static async Task<IResult> QueueDownload(QueueDownloadRequest body, SoulseekClient client, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Username) || string.IsNullOrWhiteSpace(body.Filename))
            return Results.BadRequest(new { code = "params_required", message = "Username and Filename are required." });
        try
        {
            await client.QueueDownloadAsync(body.Username, body.Filename, body.Size, ct);
            return Results.Ok(new { ok = true });
        }
        catch (SoulseekNotConfiguredException)
        {
            return Results.BadRequest(new { code = "soulseek_unconfigured", message = "slskd URL + API key not set." });
        }
        catch (SoulseekUnreachableException ex)
        {
            return Results.BadRequest(new { code = "soulseek_unreachable", message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return Results.BadRequest(new { code = "soulseek_refused", message = ex.Message });
        }
    }

    /// Lists transfers AND opportunistically auto-imports any newly-completed ones if the
    /// user configured a download folder. Polled by the frontend every couple of seconds —
    /// no separate background worker needed.
    private static async Task<IResult> ListDownloads(
        SoulseekClient client,
        SoulseekOptions options,
        WispDbContext db,
        ScanQueue scanQueue,
        ILogger<SoulseekClient> log,
        CancellationToken ct)
    {
        try
        {
            var transfers = await client.ListDownloadsAsync(ct);
            await TryAutoImportCompletedAsync(transfers, options, client, db, scanQueue, log, ct);
            return Results.Ok(transfers.Select(TransferDto.From));
        }
        catch (SoulseekNotConfiguredException)
        {
            return Results.BadRequest(new { code = "soulseek_unconfigured", message = "slskd URL + API key not set." });
        }
        catch (SoulseekUnreachableException ex)
        {
            return Results.BadRequest(new { code = "soulseek_unreachable", message = ex.Message });
        }
    }

    private static async Task TryAutoImportCompletedAsync(
        IReadOnlyList<SoulseekTransfer> transfers,
        SoulseekOptions options,
        SoulseekClient client,
        WispDbContext db,
        ScanQueue scanQueue,
        ILogger log,
        CancellationToken ct)
    {
        // Detect terminal-state transfers up front. slskd reports terminal states as a comma-joined
        // flag like "Completed, Succeeded" / "Completed, Cancelled" — only "Succeeded" should land in
        // the library, the rest are nothing to import (and we still mark them seen so we don't loop).
        var terminal = transfers
            .Where(t => !string.IsNullOrEmpty(t.Id) && t.State.Contains("Completed", StringComparison.OrdinalIgnoreCase))
            .Where(t => _autoImported.TryAdd(t.Id, 0))
            .ToList();
        var importable = terminal.Where(t => t.State.Contains("Succeeded", StringComparison.OrdinalIgnoreCase)).ToList();
        if (importable.Count == 0) return;

        // Resolve the folder to scan: explicit Wisp setting wins, else fall back to whatever
        // slskd is actually using (read once via /api/v0/options and cached). This means a user who
        // configured slskd.yml but skipped Wisp's Soulseek settings still gets auto-import.
        var folder = options.DownloadFolder;
        if (string.IsNullOrWhiteSpace(folder))
        {
            folder = await client.GetEffectiveDownloadFolderAsync(ct);
            if (string.IsNullOrWhiteSpace(folder))
            {
                log.LogWarning("Soulseek: {Count} transfer(s) finished but no download folder is set in Wisp settings and slskd's options endpoint returned nothing — skipping auto-import.",
                    importable.Count);
                return;
            }
        }

        if (!Directory.Exists(folder))
        {
            log.LogWarning("Soulseek: download folder {Folder} does not exist on disk — skipping auto-import.", folder);
            return;
        }

        var rootPath = Path.GetFullPath(folder);

        // slskd preserves the uploader's directory layout (e.g. D:\Music\Mastermix - House Top Up (2024)\track.mp3).
        // Wisp users want a flat library, so move each just-finished file up to the root and prune empty leftovers.
        // Targeted by transfer basename so we never touch unrelated subfolders the user may have organised themselves.
        FlattenCompletedDownloads(importable, rootPath, log);

        log.LogInformation("Soulseek: {Count} new transfer(s) completed, kicking off library re-scan of {Folder}",
            importable.Count, rootPath);

        var job = new ScanJob
        {
            Id = Guid.NewGuid(),
            FolderPath = rootPath,
            Status = ScanStatus.Pending,
            StartedAt = DateTime.UtcNow,
        };
        db.ScanJobs.Add(job);
        await db.SaveChangesAsync(ct);
        await scanQueue.EnqueueAsync(new ScanRequest(job.Id, job.FolderPath), ct);
    }

    private static void FlattenCompletedDownloads(IReadOnlyList<SoulseekTransfer> importable, string rootPath, ILogger log)
    {
        foreach (var t in importable)
        {
            if (string.IsNullOrEmpty(t.Filename)) continue;
            // slskd uses the remote separator — backslash from Windows seeders, slash from Unix.
            var leaf = t.Filename.Replace('/', '\\').Split('\\').Last();
            if (string.IsNullOrEmpty(leaf)) continue;

            var targetAtRoot = Path.Combine(rootPath, leaf);
            // If slskd happened to land it at the root already, nothing to do.
            if (File.Exists(targetAtRoot)) continue;

            string? sourcePath;
            try
            {
                sourcePath = Directory.EnumerateFiles(rootPath, leaf, SearchOption.AllDirectories)
                    .FirstOrDefault(p => !string.Equals(
                        Path.GetDirectoryName(p),
                        rootPath,
                        StringComparison.OrdinalIgnoreCase));
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Soulseek flatten: search failed for {Leaf}", leaf);
                continue;
            }
            if (sourcePath is null) continue;

            var finalPath = targetAtRoot;
            if (File.Exists(finalPath))
            {
                var ext = Path.GetExtension(leaf);
                var stem = Path.GetFileNameWithoutExtension(leaf);
                finalPath = "";
                for (var n = 1; n < 100; n++)
                {
                    var candidate = Path.Combine(rootPath, $"{stem} ({n}){ext}");
                    if (!File.Exists(candidate)) { finalPath = candidate; break; }
                }
                if (string.IsNullOrEmpty(finalPath))
                {
                    log.LogWarning("Soulseek flatten: 100 collisions on {Leaf}, giving up", leaf);
                    continue;
                }
            }

            try
            {
                File.Move(sourcePath, finalPath);
                log.LogInformation("Soulseek flatten: {Source} → {Target}", sourcePath, finalPath);

                // Walk up removing newly-empty parents, stopping at the root.
                var dir = Path.GetDirectoryName(sourcePath);
                while (!string.IsNullOrEmpty(dir) &&
                       !string.Equals(Path.GetFullPath(dir), rootPath, StringComparison.OrdinalIgnoreCase))
                {
                    if (Directory.Exists(dir) && !Directory.EnumerateFileSystemEntries(dir).Any())
                    {
                        Directory.Delete(dir);
                        dir = Path.GetDirectoryName(dir);
                    }
                    else break;
                }
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Soulseek flatten: move failed {Source} → {Target}", sourcePath, finalPath);
            }
        }
    }
}
