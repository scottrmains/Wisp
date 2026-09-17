using Microsoft.EntityFrameworkCore;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Recordings;

public static class ExportEndpoints
{
    public static void MapRecordingExports(this WebApplication app)
    {
        var api = app.MapGroup("/api/recording-exports");
        api.MapGet("/job", (RecordingExports exports) => exports.Status is { } status ? Results.Ok(status) : (IResult)Results.NoContent());
        api.MapPost("/job/{id:guid}/cancel", (Guid id, RecordingExports exports) => Guard(async () => { await exports.Cancel(id); return Results.NoContent(); }));
        api.MapPost("/{id:guid}", (Guid id, MixExportRequest request, RecordingExports exports) => Guard(async () => Results.Ok(await exports.Start(id, request))));
        api.MapGet("/{id:guid}", (Guid id, RecordingWorkspace workspace, WispDbContext db) => Guard(async () =>
        {
            await workspace.Require(id);
            var rows = await db.RecordingExports.AsNoTracking().Where(r => r.RecordingId == id).OrderByDescending(r => r.CreatedAt).ToArrayAsync();
            return Results.Ok(rows.Select(r => new { r.Id, r.RecordingId, r.Title, r.Format, r.State, r.Error, r.DirectoryPath, r.CreatedAt,
                r.OutputBytes, HasTracklist = r.TracklistText != null, Available = RecordingExports.Available(r) }));
        }));
        api.MapGet("/audio/{id:guid}", (Guid id, WispDbContext db) => Guard(async () =>
        {
            var row = await db.RecordingExports.FindAsync(id);
            if (row == null || !await db.RecordingSessions.AnyAsync(s => s.Id == row.RecordingId && !s.Hidden && s.State == "Ready") || !RecordingExports.Available(row))
                return Results.NotFound(new { message = "Export is missing or changed. Reconnect its drive or create a new export." });
            return Results.File(Path.Combine(row.DirectoryPath, MixExportEncoder.FileName(row.Format)), row.Format == "mp3" ? "audio/mpeg" : "audio/wav", enableRangeProcessing: true);
        }));
    }
    private static async Task<IResult> Guard(Func<Task<IResult>> action)
    {
        try { return await action(); }
        catch (ArgumentException ex) { return Results.Json(new { message = ex.Message }, statusCode: 400); }
        catch (InvalidOperationException ex) { return Results.Json(new { message = ex.Message }, statusCode: 409); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or DbUpdateException or System.Text.Json.JsonException)
        { return Results.Json(new { message = "Could not start or read this export. " + ex.Message }, statusCode: 422); }
    }
}
