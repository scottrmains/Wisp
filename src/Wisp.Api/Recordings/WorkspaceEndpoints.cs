using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Wisp.Core.Recordings;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Recordings;

public static class WorkspaceEndpoints
{
    public sealed record ImportRequest(Guid RequestId, string Path, string Folder);
    public sealed record ReviewRequest(int Revision, int? Rating, RecordingMarker[] Markers);
    public static void MapRecordingWorkspace(this WebApplication app)
    {
        var api = app.MapGroup("/api/recording-workspace");
        api.MapGet("/job", (RecordingWorkspace workspace) => workspace.Status is { } job ? Results.Ok(job) : (IResult)Results.NoContent());
        api.MapPost("/job/{id:guid}/cancel", (Guid id, RecordingWorkspace workspace) => Guard(() => { workspace.Cancel(id); return Task.FromResult<IResult>(Results.NoContent()); }));
        api.MapPost("/import", (ImportRequest request, RecordingWorkspace workspace) => Guard(() => Task.FromResult<IResult>(Results.Ok(workspace.Import(request.RequestId, request.Path, request.Folder)))));
        api.MapGet("/mixes", async (WispDbContext db) =>
        {
            var sessions = await db.RecordingSessions.AsNoTracking().Where(s => !s.Hidden && s.State != "Deleted").OrderByDescending(s => s.StartedAt).ToArrayAsync();
            var reviews = await db.RecordingReviews.AsNoTracking().ToDictionaryAsync(r => r.Id);
            var feedback = await db.RecordingFeedback.AsNoTracking().ToDictionaryAsync(r => r.Id);
            return Results.Ok(sessions.Select(s => new { Session = s, Rating = reviews.GetValueOrDefault(s.Id)?.Rating, ReviewStatus = feedback.GetValueOrDefault(s.Id)?.Status ?? "Practice",
                Duration = s.SampleRate > 0 ? s.AudioBytes / (s.SampleRate * 8d) : 0,
                Missing = s.State == "Ready" && !File.Exists(RecordingWorkspace.AudioPath(s)) }));
        });
        api.MapGet("/{id:guid}/peaks", (Guid id, RecordingWorkspace workspace) => Guard(async () =>
            await workspace.Peaks(id) is { } peaks ? Results.Ok(peaks) : Results.NoContent()));
        api.MapPost("/{id:guid}/peaks", (Guid id, RecordingWorkspace workspace) => Guard(() => Task.FromResult<IResult>(Results.Ok(workspace.StartPeaks(id)))));
        api.MapGet("/{id:guid}/review", (Guid id, RecordingWorkspace workspace, WispDbContext db) => Guard(async () =>
        {
            await workspace.Require(id); var review = await db.RecordingReviews.FindAsync(id);
            return Results.Ok(new { Revision = review?.Revision ?? 0, review?.Rating, Markers = JsonSerializer.Deserialize<RecordingMarker[]>(review?.MarkersJson ?? "[]") });
        }));
        api.MapPost("/{id:guid}/review", (Guid id, ReviewRequest request, RecordingWorkspace workspace, MixRecorder recorder, WispDbContext db) => Guard(async () =>
        {
            var session = await workspace.Require(id);
            var status = recorder.Status;
            var review = await db.RecordingReviews.FindAsync(id);
            // New live markers use the server's captured-frame clock, not the
            // last polled UI timestamp. Existing markers retain their positions.
            if (request.Markers != null && status.Busy && status.Session?.Id == id)
            {
                var previous = JsonSerializer.Deserialize<RecordingMarker[]>(review?.MarkersJson ?? "[]")!;
                request = request with { Markers = request.Markers.Select(m => previous.Any(p => p.Id == m.Id) ? m : m with { Seconds = status.Seconds }).ToArray() };
            }
            double duration = status.Busy && status.Session?.Id == id ? status.Seconds : session.AudioBytes / (session.SampleRate * 8d);
            if (request.Rating is < 1 or > 5 || request.Markers == null || request.Markers.Length > 500 ||
                request.Markers.Any(m => m.Id == Guid.Empty || !double.IsFinite(m.Seconds) || m.Seconds < 0 || m.Seconds > duration || string.IsNullOrWhiteSpace(m.Label) || m.Label.Length > 200) ||
                request.Markers.Select(m => m.Id).Distinct().Count() != request.Markers.Length)
                throw new ArgumentException("Choose a rating from 1–5 or leave it unrated. Markers must be within the recorded audio, with labels up to 200 characters (maximum 500).");
            if ((review?.Revision ?? 0) != request.Revision) throw new InvalidOperationException("This review changed. Refresh it before saving again; your edits have not been applied.");
            if (review == null) { review = new() { Id = id }; db.RecordingReviews.Add(review); }
            review.Rating = request.Rating; review.MarkersJson = JsonSerializer.Serialize(request.Markers.OrderBy(m => m.Seconds)); review.Revision++;
            await db.SaveChangesAsync(); return Results.Ok(new { review.Revision });
        }));
    }
    private static async Task<IResult> Guard(Func<Task<IResult>> work)
    {
        try { return await work(); }
        catch (ArgumentException ex) { return Results.Json(new { message = ex.Message }, statusCode: 400); }
        catch (DbUpdateException) { return Results.Json(new { message = "The recording changed or could not be saved. Refresh and retry." }, statusCode: 409); }
        catch (InvalidOperationException ex) { return Results.Json(new { message = ex.Message }, statusCode: 409); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        { return Results.Json(new { message = "Could not read or save this recording. Check its drive, permissions and available space. " + ex.Message }, statusCode: 422); }
    }
}
