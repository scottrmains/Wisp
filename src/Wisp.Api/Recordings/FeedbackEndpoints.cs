using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Wisp.Core.Recordings;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Recordings;

public static class FeedbackEndpoints
{
    public sealed record SaveRequest(int Revision, string Notes, string Status, MixAnnotation[] Annotations, Guid? LiveAnnotationId = null, int? Rating = null, int? RatingRevision = null);
    internal static T[] Read<T>(string? json) => JsonSerializer.Deserialize<T[]>(json ?? "[]")!;
    public static void MapRecordingFeedback(this WebApplication app)
    {
        var api = app.MapGroup("/api/recording-feedback");
        api.MapGet("/{id:guid}", (Guid id, RecordingWorkspace workspace, WispDbContext db) => Guard(async () =>
        {
            await workspace.Require(id);
            var review = await db.RecordingFeedback.AsNoTracking().SingleOrDefaultAsync(r => r.Id == id);
            var rating = await db.RecordingReviews.AsNoTracking().SingleOrDefaultAsync(r => r.Id == id);
            var list = await db.RecordingTracklists.AsNoTracking().SingleOrDefaultAsync(r => r.Id == id);
            var ids = Read<PerformedEntry>(list?.EntriesJson).Select(e => e.Id).ToHashSet();
            var annotations = Read<MixAnnotation>(review?.AnnotationsJson);
            return Results.Ok(new { Revision = review?.Revision ?? 0, Notes = review?.Notes ?? "", Status = review?.Status ?? "Practice", Annotations = annotations, rating?.Rating, RatingRevision = rating?.Revision ?? 0,
                DetachedAnnotationIds = annotations.Where(a => (a.OccurrenceId.HasValue && !ids.Contains(a.OccurrenceId.Value)) || (a.ToOccurrenceId.HasValue && !ids.Contains(a.ToOccurrenceId.Value))).Select(a => a.Id) });
        }));
        api.MapPost("/{id:guid}", (Guid id, SaveRequest request, RecordingWorkspace workspace, MixRecorder recorder, WispDbContext db) => Guard(async () =>
        {
            var session = await workspace.Require(id);
            await using var tx = await db.Database.BeginTransactionAsync();
            var review = await db.RecordingFeedback.FindAsync(id);
            if ((review?.Revision ?? 0) != request.Revision) throw new InvalidOperationException("Saved feedback changed. Your draft has not been applied. Review the saved copy before retrying.");
            var previous = Read<MixAnnotation>(review?.AnnotationsJson);
            var clock = recorder.Status;
            if (request.Annotations == null || request.Annotations.Any(a => a == null)) throw new ArgumentException("Comments are required (an empty list is allowed).");
            if (request.LiveAnnotationId.HasValue)
            {
                if (!clock.Busy || clock.Session?.Id != id || clock.Session.State != "Recording" || previous.Any(a => a.Id == request.LiveAnnotationId))
                    throw new InvalidOperationException("Live marking requires a new comment on the active recording.");
                if (request.Annotations.Count(a => a.Id == request.LiveAnnotationId) != 1) throw new ArgumentException("Select one new live comment.");
                request = request with { Annotations = request.Annotations.Select(a => a.Id == request.LiveAnnotationId ? a with { Seconds = clock.Seconds, EndSeconds = null } : a).ToArray() };
            }
            var duration = clock.Busy && clock.Session?.Id == id ? clock.Seconds : session.AudioBytes / (session.SampleRate * 8d);
            MixFeedbackRules.Validate(request.Notes, request.Status, request.Annotations, duration);
            if (request.RatingRevision.HasValue)
            {
                if (request.Rating is < 1 or > 5) throw new ArgumentException("Choose 1–5 or leave the mix unrated.");
                var rating = await db.RecordingReviews.FindAsync(id);
                if ((rating?.Revision ?? 0) != request.RatingRevision) throw new InvalidOperationException("The rating or quick markers changed. Refresh the saved review before retrying; your draft was not applied.");
                if (rating == null) { rating = new() { Id = id }; db.RecordingReviews.Add(rating); }
                rating.Rating = request.Rating; rating.Revision++;
            }
            var list = await db.RecordingTracklists.FindAsync(id);
            var entries = Read<PerformedEntry>(list?.EntriesJson).ToDictionary(e => e.Id);
            string Label(Guid key) => entries.TryGetValue(key, out var e) ? $"{e.Artist} — {e.Title}" : throw new ArgumentException("That track occurrence was removed. Choose another association or leave the comment unassigned.");
            var annotations = request.Annotations.Select(a =>
            {
                var old = previous.FirstOrDefault(p => p.Id == a.Id);
                // Preserve copied association text even if an occurrence was subsequently removed.
                var label = old != null && old.OccurrenceId == a.OccurrenceId && old.ToOccurrenceId == a.ToOccurrenceId ? old.AssociationLabel :
                    a.OccurrenceId.HasValue ? Label(a.OccurrenceId.Value) + (a.ToOccurrenceId.HasValue ? " → " + Label(a.ToOccurrenceId.Value) : "") : null;
                return a with { AssociationLabel = label };
            }).OrderBy(a => a.Seconds).ToArray();
            if (review == null) { review = new() { Id = id }; db.RecordingFeedback.Add(review); }
            review.Notes = request.Notes; review.Status = request.Status; review.AnnotationsJson = JsonSerializer.Serialize(annotations); review.Revision++;
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(new { review.Revision });
        }));
        api.MapGet("/{id:guid}/revisions", (Guid id, RecordingWorkspace workspace, WispDbContext db) => Guard(async () =>
        {
            await workspace.Require(id);
            var revisions = await db.RecordingPlanRevisions.AsNoTracking().Where(r => r.RecordingId == id).OrderByDescending(r => r.CreatedAt).ToArrayAsync();
            var planIds = revisions.Select(r => r.Id).ToArray(); var existing = await db.MixPlans.Where(p => planIds.Contains(p.Id)).Select(p => p.Id).ToArrayAsync();
            return Results.Ok(revisions.Select(r => new { r.Id, r.PlanName, r.Source, r.CreatedAt, Exists = existing.Contains(r.Id) }));
        }));
        api.MapGet("/plans/{planId:guid}/origin", async (Guid planId, WispDbContext db) =>
        {
            var revision = await db.RecordingPlanRevisions.AsNoTracking().SingleOrDefaultAsync(r => r.Id == planId);
            if (revision == null) return (IResult)Results.NoContent();
            return Results.Ok(new { revision.RecordingId, revision.RecordingTitle, revision.ParentPlanId, revision.Source,
                RecordingExists = await db.RecordingSessions.AnyAsync(s => s.Id == revision.RecordingId && !s.Hidden && s.State != "Deleted") });
        });
        api.MapPost("/{id:guid}/preview", (Guid id, PlanRevisionRequest request, RecordingWorkspace workspace, WispDbContext db) => Guard(async () =>
            Results.Ok(await RecordingPlanRevisions.Preview(id, request, await workspace.Require(id), db))));
        api.MapPost("/{id:guid}/revise", (Guid id, PlanRevisionRequest request, RecordingWorkspace workspace, WispDbContext db) => Guard(async () =>
            Results.Ok(await RecordingPlanRevisions.Create(id, request, await workspace.Require(id), db))));
    }
    private static async Task<IResult> Guard(Func<Task<IResult>> action)
    {
        try { return await action(); }
        catch (ArgumentException ex) { return Results.Json(new { message = ex.Message }, statusCode: 400); }
        catch (DbUpdateException) { return Results.Json(new { message = "The saved data changed or could not be written. Refresh and review before retrying." }, statusCode: 409); }
        catch (InvalidOperationException ex) { return Results.Json(new { message = ex.Message }, statusCode: 409); }
        catch (JsonException) { return Results.Json(new { message = "Saved review data could not be read. Nothing was replaced." }, statusCode: 422); }
    }
}
