using Microsoft.EntityFrameworkCore;
using Wisp.Core.MixPlans;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.MixPlans;

public static class MixPlanEndpoints
{
    public static IEndpointRouteBuilder MapMixPlans(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/mix-plans");

        g.MapGet("", List);
        g.MapPost("", Create);
        g.MapGet("{id:guid}", Get);
        g.MapPatch("{id:guid}", Update);
        g.MapDelete("{id:guid}", Delete);

        g.MapPost("{id:guid}/tracks", AddTrack);
        g.MapPatch("{id:guid}/tracks/{mptId:guid}", UpdateTrack);
        g.MapDelete("{id:guid}/tracks/{mptId:guid}", RemoveTrack);

        return app;
    }

    private static async Task<IResult> List(WispDbContext db, CancellationToken ct)
    {
        // EF can't SQL-translate OrderBy applied after a constructor projection — order first, then project.
        var plans = await db.MixPlans
            .AsNoTracking()
            .OrderByDescending(p => p.UpdatedAt)
            .Select(p => new MixPlanSummaryDto(
                p.Id, p.Name, p.Notes, p.Tracks.Count, p.CreatedAt, p.UpdatedAt))
            .ToListAsync(ct);
        return Results.Ok(plans);
    }

    private static async Task<IResult> Create(CreateMixPlanRequest body, WispDbContext db, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Name))
            return Results.BadRequest(new { code = "name_required", message = "Name is required." });

        var now = DateTime.UtcNow;
        var plan = new MixPlan
        {
            Id = Guid.NewGuid(),
            Name = body.Name.Trim(),
            Notes = body.Notes,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.MixPlans.Add(plan);
        await db.SaveChangesAsync(ct);

        return Results.Created($"/api/mix-plans/{plan.Id}", new MixPlanSummaryDto(
            plan.Id, plan.Name, plan.Notes, 0, plan.CreatedAt, plan.UpdatedAt));
    }

    private static async Task<IResult> Get(Guid id, WispDbContext db, CancellationToken ct)
    {
        var plan = await LoadPlan(db, id, ct);
        return plan is null ? Results.NotFound() : Results.Ok(ToDto(plan));
    }

    private static async Task<IResult> Update(
        Guid id, UpdateMixPlanRequest body, WispDbContext db, CancellationToken ct)
    {
        var plan = await db.MixPlans.FindAsync([id], ct);
        if (plan is null) return Results.NotFound();

        if (body.Name is not null)
        {
            if (string.IsNullOrWhiteSpace(body.Name))
                return Results.BadRequest(new { code = "name_required", message = "Name cannot be blank." });
            plan.Name = body.Name.Trim();
        }
        if (body.Notes is not null) plan.Notes = body.Notes;

        plan.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        return Results.Ok(new MixPlanSummaryDto(
            plan.Id, plan.Name, plan.Notes,
            await db.MixPlanTracks.CountAsync(t => t.MixPlanId == id, ct),
            plan.CreatedAt, plan.UpdatedAt));
    }

    private static async Task<IResult> Delete(Guid id, WispDbContext db, CancellationToken ct)
    {
        var plan = await db.MixPlans.FindAsync([id], ct);
        if (plan is null) return Results.NotFound();
        db.MixPlans.Remove(plan);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> AddTrack(
        Guid id, AddMixPlanTrackRequest body, WispDbContext db, CancellationToken ct)
    {
        var plan = await db.MixPlans.FindAsync([id], ct);
        if (plan is null) return Results.NotFound();

        var trackExists = await db.Tracks.AnyAsync(t => t.Id == body.TrackId, ct);
        if (!trackExists)
            return Results.BadRequest(new { code = "track_not_found", message = "Track does not exist." });

        var siblings = await db.MixPlanTracks
            .Where(t => t.MixPlanId == id)
            .OrderBy(t => t.Order)
            .ToListAsync(ct);

        // AddTrack default: null = append to end. Use the move semantics only when
        // the caller explicitly anchors the insertion (specific id or Guid.Empty for head).
        var newOrder = body.AfterMixPlanTrackId is null
            ? FractionalOrder.Between(siblings.LastOrDefault()?.Order, null)
            : ComputeOrderAfter(siblings, body.AfterMixPlanTrackId == Guid.Empty ? null : body.AfterMixPlanTrackId);

        var mpt = new MixPlanTrack
        {
            Id = Guid.NewGuid(),
            MixPlanId = id,
            TrackId = body.TrackId,
            Order = newOrder,
        };
        db.MixPlanTracks.Add(mpt);
        plan.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        // Reload with track for the response.
        var loaded = await db.MixPlanTracks
            .AsNoTracking()
            .Include(t => t.Track)
            .FirstAsync(t => t.Id == mpt.Id, ct);

        return Results.Created($"/api/mix-plans/{id}/tracks/{mpt.Id}", MixPlanTrackDto.From(loaded));
    }

    private static async Task<IResult> UpdateTrack(
        Guid id, Guid mptId, UpdateMixPlanTrackRequest body, WispDbContext db, CancellationToken ct)
    {
        var mpt = await db.MixPlanTracks.FirstOrDefaultAsync(t => t.Id == mptId && t.MixPlanId == id, ct);
        if (mpt is null) return Results.NotFound();

        if (body.TransitionNotes is not null) mpt.TransitionNotes = body.TransitionNotes;

        // The "afterTrackId" key may also be the literal "head" (passed as Guid.Empty by convention).
        if (body.AfterMixPlanTrackId is { } anchor)
        {
            var siblings = await db.MixPlanTracks
                .Where(t => t.MixPlanId == id && t.Id != mptId)
                .OrderBy(t => t.Order)
                .ToListAsync(ct);

            mpt.Order = ComputeOrderAfter(siblings, anchor == Guid.Empty ? null : anchor);
        }

        var plan = await db.MixPlans.FindAsync([id], ct);
        if (plan is not null) plan.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var loaded = await db.MixPlanTracks
            .AsNoTracking()
            .Include(t => t.Track)
            .FirstAsync(t => t.Id == mptId, ct);
        return Results.Ok(MixPlanTrackDto.From(loaded));
    }

    private static async Task<IResult> RemoveTrack(
        Guid id, Guid mptId, WispDbContext db, CancellationToken ct)
    {
        var mpt = await db.MixPlanTracks.FirstOrDefaultAsync(t => t.Id == mptId && t.MixPlanId == id, ct);
        if (mpt is null) return Results.NotFound();
        db.MixPlanTracks.Remove(mpt);

        var plan = await db.MixPlans.FindAsync([id], ct);
        if (plan is not null) plan.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    /// `afterId` semantics: null = insert at head; non-null = insert immediately after that row.
    private static double ComputeOrderAfter(List<MixPlanTrack> sortedSiblings, Guid? afterId)
    {
        if (afterId is null)
        {
            var first = sortedSiblings.FirstOrDefault();
            return FractionalOrder.Between(null, first?.Order);
        }

        var idx = sortedSiblings.FindIndex(s => s.Id == afterId.Value);
        if (idx < 0)
        {
            // Anchor not found — append at the end as a safe default.
            var last = sortedSiblings.LastOrDefault();
            return FractionalOrder.Between(last?.Order, null);
        }

        var before = sortedSiblings[idx];
        var after = idx + 1 < sortedSiblings.Count ? sortedSiblings[idx + 1] : null;
        return FractionalOrder.Between(before.Order, after?.Order);
    }

    private static async Task<MixPlan?> LoadPlan(WispDbContext db, Guid id, CancellationToken ct)
        => await db.MixPlans
            .AsNoTracking()
            .Include(p => p.Tracks.OrderBy(t => t.Order))
            .ThenInclude(t => t.Track)
            .FirstOrDefaultAsync(p => p.Id == id, ct);

    private static MixPlanDto ToDto(MixPlan plan) => new(
        plan.Id, plan.Name, plan.Notes, plan.CreatedAt, plan.UpdatedAt,
        plan.Tracks.Select(MixPlanTrackDto.From).ToList());
}
