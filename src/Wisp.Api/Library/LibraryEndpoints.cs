using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Library;

public static class LibraryEndpoints
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() }
    };

    public static IEndpointRouteBuilder MapLibrary(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/library");

        g.MapPost("/scan", StartScan);
        g.MapGet("/scan/{id:guid}", GetScan);
        g.MapGet("/scan/{id:guid}/events", StreamScan);

        var tracks = app.MapGroup("/api/tracks");
        tracks.MapGet("", ListTracks);
        tracks.MapGet("{id:guid}", GetTrack);

        return app;
    }

    private static async Task<IResult> StartScan(
        StartScanRequest body,
        WispDbContext db,
        ScanQueue queue,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.FolderPath))
            return Results.BadRequest(new { code = "folder_required", message = "FolderPath is required." });
        if (!Directory.Exists(body.FolderPath))
            return Results.BadRequest(new { code = "folder_not_found", message = $"Folder not found: {body.FolderPath}" });

        var job = new ScanJob
        {
            Id = Guid.NewGuid(),
            FolderPath = Path.GetFullPath(body.FolderPath),
            Status = ScanStatus.Pending,
            StartedAt = DateTime.UtcNow,
        };
        db.ScanJobs.Add(job);
        await db.SaveChangesAsync(ct);
        await queue.EnqueueAsync(new ScanRequest(job.Id, job.FolderPath), ct);

        return Results.Accepted($"/api/library/scan/{job.Id}", ScanJobDto.From(job));
    }

    private static async Task<IResult> GetScan(Guid id, WispDbContext db, CancellationToken ct)
    {
        var job = await db.ScanJobs.FindAsync([id], ct);
        return job is null ? Results.NotFound() : Results.Ok(ScanJobDto.From(job));
    }

    private static async Task StreamScan(
        Guid id,
        HttpContext ctx,
        WispDbContext db,
        ScanProgressBus bus,
        CancellationToken ct)
    {
        var job = await db.ScanJobs.FindAsync([id], ct);
        if (job is null)
        {
            ctx.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        ctx.Response.Headers.ContentType = "text/event-stream";
        ctx.Response.Headers.CacheControl = "no-cache";
        ctx.Response.Headers.Connection = "keep-alive";
        // disable response buffering for SSE
        ctx.Response.Headers["X-Accel-Buffering"] = "no";

        // Replay current state immediately so a late subscriber catches up.
        await WriteEvent(ctx, ScanProgressFor(job), ct);

        if (job.Status is ScanStatus.Completed or ScanStatus.Failed or ScanStatus.Cancelled)
            return;

        await foreach (var p in bus.SubscribeAsync(id, ct))
        {
            await WriteEvent(ctx, p, ct);
            if (p.Status is ScanStatus.Completed or ScanStatus.Failed or ScanStatus.Cancelled)
                break;
        }
    }

    private static async Task WriteEvent(HttpContext ctx, ScanProgress p, CancellationToken ct)
    {
        var payload = JsonSerializer.Serialize(p, Json);
        await ctx.Response.WriteAsync($"data: {payload}\n\n", ct);
        await ctx.Response.Body.FlushAsync(ct);
    }

    private static ScanProgress ScanProgressFor(ScanJob s) => new(
        s.Id, s.Status, s.TotalFiles, s.ScannedFiles,
        s.AddedTracks, s.UpdatedTracks, s.RemovedTracks, s.SkippedFiles, s.Error);

    private static async Task<IResult> ListTracks(
        WispDbContext db,
        string? search = null,
        string? key = null,
        decimal? bpmMin = null,
        decimal? bpmMax = null,
        int? energyMin = null,
        int? energyMax = null,
        bool? missing = null,
        string? sort = null,
        int page = 1,
        int size = 100,
        CancellationToken ct = default)
    {
        if (page < 1) page = 1;
        size = Math.Clamp(size, 1, 1000);

        IQueryable<Track> q = db.Tracks.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            q = q.Where(t =>
                (t.Artist != null && EF.Functions.Like(t.Artist, $"%{s}%")) ||
                (t.Title != null && EF.Functions.Like(t.Title, $"%{s}%")) ||
                (t.Album != null && EF.Functions.Like(t.Album, $"%{s}%")));
        }

        if (!string.IsNullOrWhiteSpace(key))
            q = q.Where(t => t.MusicalKey == key);

        if (bpmMin.HasValue) q = q.Where(t => t.Bpm >= bpmMin);
        if (bpmMax.HasValue) q = q.Where(t => t.Bpm <= bpmMax);
        if (energyMin.HasValue) q = q.Where(t => t.Energy >= energyMin);
        if (energyMax.HasValue) q = q.Where(t => t.Energy <= energyMax);
        if (missing == true) q = q.Where(t => t.IsMissingMetadata);

        q = (sort?.ToLowerInvariant()) switch
        {
            "bpm" => q.OrderBy(t => t.Bpm),
            "-bpm" => q.OrderByDescending(t => t.Bpm),
            "energy" => q.OrderBy(t => t.Energy),
            "-energy" => q.OrderByDescending(t => t.Energy),
            "title" => q.OrderBy(t => t.Title),
            "added" => q.OrderBy(t => t.AddedAt),
            "-added" => q.OrderByDescending(t => t.AddedAt),
            _ => q.OrderBy(t => t.Artist).ThenBy(t => t.Title),
        };

        var total = await q.CountAsync(ct);
        var items = await q.Skip((page - 1) * size).Take(size).ToListAsync(ct);

        return Results.Ok(new TrackPageDto(items.Select(TrackDto.From).ToList(), total, page, size));
    }

    private static async Task<IResult> GetTrack(Guid id, WispDbContext db, CancellationToken ct)
    {
        var t = await db.Tracks.FindAsync([id], ct);
        return t is null ? Results.NotFound() : Results.Ok(TrackDto.From(t));
    }
}
