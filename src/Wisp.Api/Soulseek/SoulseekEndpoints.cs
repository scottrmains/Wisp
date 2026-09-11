using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Wisp.Api.Settings;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.ExternalCatalog.Soulseek;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Soulseek;

public static class SoulseekEndpoints
{
    private static readonly SemaphoreSlim ImportGate = new(1, 1);
    /// Tracks transfers we've already auto-imported so a single completion only re-scans once.
    private static readonly ConcurrentDictionary<string, Guid> _autoImported = new();

    public static IEndpointRouteBuilder MapSoulseek(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/soulseek/test", TestConnection);
        app.MapPost("/api/soulseek/searches", StartSearch);
        app.MapGet("/api/soulseek/searches/{id}", GetSearch);
        app.MapPost("/api/soulseek/downloads", QueueDownload);
        app.MapGet("/api/soulseek/downloads", ListDownloads);
        app.MapPost("/api/soulseek/downloads/cancel", CancelDownload);
        app.MapPost("/api/soulseek/downloads/clear", ClearDownloads);
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

    /// Lists transfers AND opportunistically auto-imports newly-completed ones from the
    /// daemon's active download folder. Polled by the frontend every couple of seconds —
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
            if (await ImportGate.WaitAsync(0, ct))
            {
                try { await TryAutoImportCompletedAsync(transfers, options, client, db, scanQueue, log, ct); }
                finally { ImportGate.Release(); }
            }
            return Results.Ok(transfers.Select(t => TransferDto.From(t) with
            {
                ImportScanId = _autoImported.TryGetValue(t.Id, out var scanId) ? scanId : null,
            }));
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
        // the library; failed or cancelled transfers must not trigger an import.
        var terminal = transfers
            .Where(t => !string.IsNullOrEmpty(t.Id) && SoulseekTransferState.IsFinished(t.State))
            .Where(t => !_autoImported.ContainsKey(t.Id))
            .ToList();
        var importable = terminal.Where(t => SoulseekTransferState.IsSuccessful(t.State)).ToList();
        if (importable.Count == 0) return;

        // Import from the daemon's active destination, not a saved preference
        // that will only take effect after Wisp restarts.
        var folder = await client.GetEffectiveDownloadFolderAsync(ct) ?? options.ActiveDownloadFolder;
        if (string.IsNullOrWhiteSpace(folder))
        {
            log.LogWarning("Soulseek: active download folder is unknown; import will retry on the next transfer poll");
            return;
        }

        if (!Directory.Exists(folder))
        {
            log.LogWarning("Soulseek: download folder {Folder} does not exist on disk — skipping auto-import.", folder);
            return;
        }

        var rootPath = Path.GetFullPath(folder);

        // Preserve the daemon's downloaded subfolders. Scanning indexes them in
        // place; matching only a basename could move an unrelated library file.
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
        foreach (var transfer in importable) _autoImported.TryAdd(transfer.Id, job.Id);
    }

    private static async Task<IResult> CancelDownload(TransferActionRequest body, SoulseekClient client, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Username) || !Guid.TryParse(body.Id, out _))
            return Results.BadRequest(new { message = "A transfer username and valid ID are required." });
        try
        {
            var transfer = (await client.ListDownloadsAsync(ct)).FirstOrDefault(t => t.Id == body.Id && t.Username == body.Username);
            if (transfer is null) return Results.NotFound(new { message = "This transfer is no longer in the list. Refresh and try again." });
            if (SoulseekTransferState.IsFinished(transfer.State))
                return Results.Conflict(new { message = "This transfer has already finished. Use Clear to remove it from the list." });
            await client.CancelDownloadAsync(transfer.Username, transfer.Id, remove: false, ct);
            return Results.NoContent();
        }
        catch (Exception ex) when (ex is SoulseekNotConfiguredException or SoulseekUnreachableException or InvalidOperationException)
        {
            return Results.BadRequest(new { message = ex.Message });
        }
    }

    private static async Task<IResult> ClearDownloads(TransferActionRequest body, SoulseekClient client,
        WispDbContext db, CancellationToken ct)
    {
        var single = body.Id is not null || body.Username is not null;
        if (single && (string.IsNullOrWhiteSpace(body.Username) || !Guid.TryParse(body.Id, out _)))
            return Results.BadRequest(new { message = "A transfer username and valid ID are required." });
        // Serialize with auto-import: never clear the only record of a successful
        // download before WISP has finished indexing it into the library.
        await ImportGate.WaitAsync(ct);
        try
        {
            var transfers = await client.ListDownloadsAsync(ct);
            var targets = transfers.Where(t => !single || (t.Id == body.Id && t.Username == body.Username)).ToList();
            if (single && targets.Count == 0) return Results.Ok(new ClearTransfersResult([], 0, []));
            if (single && targets.Any(t => !SoulseekTransferState.IsFinished(t.State)))
                return Results.Conflict(new { message = "This transfer is still active. Cancel it first." });
            var cleared = new List<string>();
            var errors = new List<string>();
            var skipped = 0;
            foreach (var transfer in targets.Where(t => SoulseekTransferState.IsFinished(t.State)))
            {
                if (SoulseekTransferState.IsSuccessful(transfer.State) &&
                    (!_autoImported.TryGetValue(transfer.Id, out var scanId) ||
                     !await db.ScanJobs.AnyAsync(s => s.Id == scanId && s.Status == ScanStatus.Completed, ct)))
                {
                    skipped++;
                    continue;
                }
                try
                {
                    await client.CancelDownloadAsync(transfer.Username, transfer.Id, remove: true, ct);
                    cleared.Add(transfer.Id);
                    // Retain the import receipt: an already-in-flight list poll
                    // may still contain this record and must not re-import it.
                }
                catch (Exception ex) when (ex is SoulseekUnreachableException or InvalidOperationException)
                {
                    errors.Add($"{transfer.Filename}: {ex.Message}");
                }
            }
            return Results.Ok(new ClearTransfersResult(cleared, skipped, errors));
        }
        catch (Exception ex) when (ex is SoulseekNotConfiguredException or SoulseekUnreachableException or InvalidOperationException)
        {
            return Results.BadRequest(new { message = ex.Message });
        }
        finally { ImportGate.Release(); }
    }
}
