using Microsoft.EntityFrameworkCore;
using Wisp.Core.Feedback;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Feedback;

public static class BlendRatingEndpoints
{
    public static IEndpointRouteBuilder MapBlendRatings(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/blend-ratings");
        g.MapGet("", GetForPair);
        g.MapPost("", Upsert);
        return app;
    }

    /// Lookup the most recent rating (if any) for a given A→B transition. The blend modal
    /// calls this on open so it can preselect the user's prior verdict.
    private static async Task<IResult> GetForPair(Guid trackAId, Guid trackBId, WispDbContext db, CancellationToken ct)
    {
        var existing = await db.BlendRatings
            .AsNoTracking()
            .Where(r => r.TrackAId == trackAId && r.TrackBId == trackBId)
            .OrderByDescending(r => r.RatedAt)
            .FirstOrDefaultAsync(ct);
        return existing is null ? Results.NoContent() : Results.Ok(BlendRatingDto.From(existing));
    }

    /// Upsert by (TrackAId, TrackBId, latest) — overwriting the most recent row keeps the
    /// table from growing unbounded while still letting the user change their mind.
    private static async Task<IResult> Upsert(BlendRatingUpsertRequest body, WispDbContext db, CancellationToken ct)
    {
        if (body.TrackAId == Guid.Empty || body.TrackBId == Guid.Empty)
            return Results.BadRequest(new { code = "track_required", message = "Both TrackAId and TrackBId are required." });

        var existing = await db.BlendRatings
            .Where(r => r.TrackAId == body.TrackAId && r.TrackBId == body.TrackBId)
            .OrderByDescending(r => r.RatedAt)
            .FirstOrDefaultAsync(ct);

        var now = DateTime.UtcNow;
        if (existing is null)
        {
            existing = new BlendRating
            {
                Id = Guid.NewGuid(),
                TrackAId = body.TrackAId,
                TrackBId = body.TrackBId,
            };
            db.BlendRatings.Add(existing);
        }

        existing.Rating = body.Rating;
        existing.ContextNotes = string.IsNullOrWhiteSpace(body.ContextNotes) ? null : body.ContextNotes.Trim();
        existing.RatedAt = now;

        await db.SaveChangesAsync(ct);
        return Results.Ok(BlendRatingDto.From(existing));
    }
}

public sealed record BlendRatingUpsertRequest(Guid TrackAId, Guid TrackBId, BlendRatingValue Rating, string? ContextNotes);

public sealed record BlendRatingDto(Guid Id, Guid TrackAId, Guid TrackBId, BlendRatingValue Rating, string? ContextNotes, DateTime RatedAt)
{
    public static BlendRatingDto From(BlendRating r) =>
        new(r.Id, r.TrackAId, r.TrackBId, r.Rating, r.ContextNotes, r.RatedAt);
}
