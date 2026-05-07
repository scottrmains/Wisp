using Microsoft.EntityFrameworkCore;
using Wisp.Infrastructure.Cleanup;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Cleanup;

public static class CleanupEndpoints
{
    public static IEndpointRouteBuilder MapCleanup(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/tracks/{id:guid}/cleanup", Preview);
        app.MapPost("/api/tracks/{id:guid}/cleanup/apply", Apply);
        app.MapGet("/api/cleanup/audits", ListAudits);
        app.MapPost("/api/cleanup/audits/{id:guid}/undo", Undo);
        return app;
    }

    private static async Task<IResult> Preview(
        Guid id, WispDbContext db, CleanupApplier applier, CancellationToken ct)
    {
        var track = await db.Tracks.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id, ct);
        if (track is null) return Results.NotFound();

        var s = applier.Preview(track);
        return Results.Ok(new CleanupSuggestionDto(s.TrackId, s.Before, s.After, s.Changes, s.HasChanges));
    }

    private static async Task<IResult> Apply(
        Guid id, CleanupApplier applier, CancellationToken ct)
    {
        try
        {
            var (audit, _) = await applier.ApplyAsync(id, ct);
            return Results.Ok(new AuditDto(
                audit.Id, audit.TrackId, audit.Action, audit.Status, audit.FailureReason,
                audit.FilePathBefore, audit.FilePathAfter, audit.CreatedAt));
        }
        catch (InvalidOperationException ex)
        {
            return Results.BadRequest(new { code = "cleanup_invalid", message = ex.Message });
        }
        catch (FileNotFoundException ex)
        {
            return Results.Problem(
                title: "File not found", detail: ex.Message, statusCode: StatusCodes.Status410Gone);
        }
        catch (Exception ex)
        {
            return Results.Problem(
                title: "Cleanup failed", detail: ex.Message, statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static async Task<IResult> ListAudits(
        WispDbContext db,
        Guid? trackId = null,
        int limit = 50,
        CancellationToken ct = default)
    {
        limit = Math.Clamp(limit, 1, 500);
        IQueryable<Wisp.Core.Cleanup.MetadataAuditLog> q = db.MetadataAuditLogs.AsNoTracking();
        if (trackId.HasValue) q = q.Where(a => a.TrackId == trackId.Value);

        var rows = await q
            .OrderByDescending(a => a.CreatedAt)
            .Take(limit)
            .Select(a => new AuditDto(
                a.Id, a.TrackId, a.Action, a.Status, a.FailureReason,
                a.FilePathBefore, a.FilePathAfter, a.CreatedAt))
            .ToListAsync(ct);
        return Results.Ok(rows);
    }

    private static async Task<IResult> Undo(
        Guid id, CleanupApplier applier, CancellationToken ct)
    {
        try
        {
            var audit = await applier.UndoAsync(id, ct);
            return Results.Ok(new AuditDto(
                audit.Id, audit.TrackId, audit.Action, audit.Status, audit.FailureReason,
                audit.FilePathBefore, audit.FilePathAfter, audit.CreatedAt));
        }
        catch (InvalidOperationException ex)
        {
            return Results.BadRequest(new { code = "undo_invalid", message = ex.Message });
        }
        catch (FileNotFoundException ex)
        {
            return Results.Problem(
                title: "File not found", detail: ex.Message, statusCode: StatusCodes.Status410Gone);
        }
        catch (Exception ex)
        {
            return Results.Problem(
                title: "Undo failed", detail: ex.Message, statusCode: StatusCodes.Status500InternalServerError);
        }
    }
}
