using Microsoft.EntityFrameworkCore;
using Wisp.Api.Library;
using Wisp.Core.MixPlans;
using Wisp.Core.Recommendations;
using Wisp.Core.Tracks;
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

        g.MapGet("{id:guid}/export", Export);
        g.MapPost("{id:guid}/suggest-route", SuggestRoute);

        return app;
    }

    private static async Task<IResult> Export(
        Guid id, string? format, WispDbContext db, CancellationToken ct)
    {
        var plan = await LoadPlan(db, id, ct);
        if (plan is null) return Results.NotFound();

        var fmt = (format ?? "m3u").ToLowerInvariant();
        var safeName = string.Concat(plan.Name.Where(c => !Path.GetInvalidFileNameChars().Contains(c)));

        return fmt switch
        {
            "m3u" or "m3u8" => Results.Text(
                MixPlanExporter.ToM3u(plan),
                contentType: "audio/x-mpegurl; charset=utf-8",
                statusCode: 200) is var r1 ? WithDownloadHeader(r1, $"{safeName}.m3u8") : r1,
            "csv" => WithDownloadHeader(
                Results.Text(MixPlanExporter.ToCsv(plan), contentType: "text/csv; charset=utf-8"),
                $"{safeName}.csv"),
            "json" => WithDownloadHeader(
                Results.Json(ToDto(plan), Json),
                $"{safeName}.json"),
            _ => Results.BadRequest(new { code = "invalid_format", message = $"Unknown format '{format}'." }),
        };
    }

    /// Wraps a result so the response carries a Content-Disposition: attachment header.
    private static IResult WithDownloadHeader(IResult inner, string fileName) =>
        new DownloadResult(inner, fileName);

    private sealed class DownloadResult(IResult inner, string fileName) : IResult
    {
        public async Task ExecuteAsync(HttpContext ctx)
        {
            // Set the header BEFORE the inner result starts writing — once response begins, headers are locked.
            ctx.Response.Headers.ContentDisposition = $"attachment; filename=\"{fileName}\"";
            await inner.ExecuteAsync(ctx);
        }
    }

    private static readonly System.Text.Json.JsonSerializerOptions Json =
        new(System.Text.Json.JsonSerializerDefaults.Web) { WriteIndented = true };

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

        // Tri-state for the recommendation scope: explicit clear flag wins, then a
        // non-empty Guid means "set to this playlist". Field omitted = leave alone.
        // (Ambiguity between "missing" and "JSON null" forces the bool flag pattern;
        // matches how the frontend's clear-button vs picker-pick split works.)
        if (body.ClearRecommendationScope == true)
        {
            plan.RecommendationScopePlaylistId = null;
        }
        else if (body.RecommendationScopePlaylistId is { } scopeId && scopeId != Guid.Empty)
        {
            // Validate the playlist exists; otherwise we'd silently accept a dangling FK.
            var exists = await db.Playlists.AnyAsync(p => p.Id == scopeId, ct);
            if (!exists)
                return Results.BadRequest(new { code = "playlist_not_found",
                    message = "Recommendation scope playlist does not exist." });
            plan.RecommendationScopePlaylistId = scopeId;
        }

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
        if (body.IsAnchor is { } anchorFlag) mpt.IsAnchor = anchorFlag;

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

    /// Bounded beam search between two anchored mix-plan tracks. Returns up to 5 short routes
    /// (each `gapTracks` long), ranked by accumulated `RecommendationService.Score(prev, next)`.
    /// Excludes archived tracks, blocked-pair (Bad-rated) candidates, and tracks already in the plan.
    /// Caps branching at top-K=8 per step and depth at gapTracks so big libraries don't blow up.
    private static async Task<IResult> SuggestRoute(
        Guid id,
        SuggestRouteRequest body,
        WispDbContext db,
        RecommendationService svc,
        CancellationToken ct)
    {
        if (body.GapTracks < 1 || body.GapTracks > 6)
            return Results.BadRequest(new { code = "invalid_gap", message = "GapTracks must be 1..6." });

        // Pull the plan itself so we can read its recommendation scope (if any).
        var plan = await db.MixPlans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct);
        if (plan is null) return Results.NotFound();

        var planTracks = await db.MixPlanTracks
            .AsNoTracking()
            .Include(t => t.Track)
            .Where(t => t.MixPlanId == id)
            .ToListAsync(ct);

        var fromMpt = planTracks.FirstOrDefault(t => t.Id == body.FromMptId);
        var toMpt = planTracks.FirstOrDefault(t => t.Id == body.ToMptId);
        if (fromMpt is null || toMpt is null) return Results.NotFound();
        if (fromMpt.Track is null || toMpt.Track is null)
            return Results.BadRequest(new { code = "track_missing", message = "Anchor tracks must exist." });

        var alreadyInPlan = planTracks.Select(t => t.TrackId).ToHashSet();

        // Block-pair filter from 15c — never bridge through a Bad-rated pair against either anchor.
        var blockedAgainstFrom = await db.BlendRatings.AsNoTracking()
            .Where(r => r.Rating == Wisp.Core.Feedback.BlendRatingValue.Bad
                && (r.TrackAId == fromMpt.TrackId || r.TrackBId == fromMpt.TrackId))
            .Select(r => r.TrackAId == fromMpt.TrackId ? r.TrackBId : r.TrackAId)
            .ToListAsync(ct);
        var blockedAgainstTo = await db.BlendRatings.AsNoTracking()
            .Where(r => r.Rating == Wisp.Core.Feedback.BlendRatingValue.Bad
                && (r.TrackAId == toMpt.TrackId || r.TrackBId == toMpt.TrackId))
            .Select(r => r.TrackAId == toMpt.TrackId ? r.TrackBId : r.TrackAId)
            .ToListAsync(ct);
        var blockedSet = new HashSet<Guid>(blockedAgainstFrom.Concat(blockedAgainstTo));

        // Candidate pool — same constraints as GetRecommendations plus the recommendation
        // scope (if the plan has one). When the plan is scoped, bridges only get to use
        // tracks from the playlist; that's the whole point of the scope.
        var candidatesQuery = db.Tracks.AsNoTracking()
            .Where(t => !t.IsArchived
                && t.Id != fromMpt.TrackId
                && t.Id != toMpt.TrackId
                && (t.MusicalKey != null || t.Bpm != null));
        if (plan.RecommendationScopePlaylistId is { } scopeId && scopeId != Guid.Empty)
        {
            candidatesQuery = candidatesQuery.Where(t =>
                db.PlaylistTracks.Any(pt => pt.PlaylistId == scopeId && pt.TrackId == t.Id));
        }
        var candidatePool = await candidatesQuery.ToListAsync(ct);
        candidatePool = candidatePool
            .Where(c => !alreadyInPlan.Contains(c.Id) && !blockedSet.Contains(c.Id))
            .ToList();

        const int topK = 8;        // candidates kept per step
        const int routesKept = 16; // partial routes carried forward each level

        // Beam search: at each level, expand each partial route by the top-K next tracks
        // (by single-step score from the route's tail), keep the best `routesKept` partials,
        // recurse. After `gapTracks` levels, score each completed route by the closing
        // transition into the To anchor and pick the top 5.
        var partials = new List<RoutePartial> { new(new List<Track>(), 0, fromMpt.Track) };

        for (var step = 0; step < body.GapTracks; step++)
        {
            var next = new List<RoutePartial>();
            foreach (var partial in partials)
            {
                var ranked = svc.Rank(partial.Tail, candidatePool, RecommendationMode.Safe, topK);
                foreach (var cand in ranked)
                {
                    if (partial.UsedTrackIds.Contains(cand.Track.Id)) continue;
                    var newPath = new List<Track>(partial.Path) { cand.Track };
                    next.Add(new RoutePartial(newPath, partial.Score + cand.Score.Total, cand.Track));
                }
            }
            partials = next
                .OrderByDescending(p => p.Score)
                .Take(routesKept)
                .ToList();
            if (partials.Count == 0) break;
        }

        // Score the closing transition into the To anchor and rank.
        var routes = partials
            .Select(p =>
            {
                // Single-track rank pass to get the score from p.Tail → toMpt.Track.
                var closingScore = svc.Score(p.Tail, toMpt.Track, RecommendationMode.Safe).Total;
                return new
                {
                    Path = p.Path,
                    TotalScore = p.Score + closingScore,
                };
            })
            .OrderByDescending(r => r.TotalScore)
            .Take(5)
            .ToList();

        if (routes.Count == 0)
            return Results.Ok(Array.Empty<SuggestedRouteDto>());

        var dtos = routes.Select(r => new SuggestedRouteDto(
            Tracks: r.Path.Select(TrackDto.From).ToList(),
            TotalScore: r.TotalScore,
            // Warnings are computed client-side from the existing summary helper; for the
            // server response we only ship a count of likely-rough transitions (BPM jump > 8).
            WarningCount: CountRoughTransitions(fromMpt.Track, r.Path, toMpt.Track),
            Summary: BuildRouteSummary(fromMpt.Track, r.Path, toMpt.Track)
        )).ToList();
        return Results.Ok(dtos);
    }

    private sealed record RoutePartial(List<Track> Path, int Score, Track Tail)
    {
        public HashSet<Guid> UsedTrackIds => Path.Select(t => t.Id).ToHashSet();
    }

    private static int CountRoughTransitions(Track from, IList<Track> middle, Track to)
    {
        var seq = new List<Track> { from };
        seq.AddRange(middle);
        seq.Add(to);
        var rough = 0;
        for (var i = 1; i < seq.Count; i++)
        {
            var a = seq[i - 1].Bpm;
            var b = seq[i].Bpm;
            if (a is not null && b is not null && Math.Abs((double)(b.Value - a.Value)) > 8) rough++;
        }
        return rough;
    }

    private static string BuildRouteSummary(Track from, IList<Track> middle, Track to)
    {
        var allBpms = new[] { from }.Concat(middle).Concat(new[] { to })
            .Select(t => t.Bpm).Where(b => b is not null).Select(b => (double)b!.Value).ToList();
        var avgBpm = allBpms.Count > 0 ? allBpms.Average() : 0;
        var allEnergies = new[] { from }.Concat(middle).Concat(new[] { to })
            .Select(t => t.Energy).Where(e => e is not null).Select(e => e!.Value).ToList();
        var energySpread = allEnergies.Count > 0
            ? $"E{allEnergies.First()} → E{allEnergies.Last()}"
            : "energy unknown";
        return $"avg {avgBpm:0} BPM · {energySpread}";
    }

    private static async Task<MixPlan?> LoadPlan(WispDbContext db, Guid id, CancellationToken ct)
        => await db.MixPlans
            .AsNoTracking()
            .Include(p => p.Tracks.OrderBy(t => t.Order))
            .ThenInclude(t => t.Track)
            .FirstOrDefaultAsync(p => p.Id == id, ct);

    private static MixPlanDto ToDto(MixPlan plan) => new(
        plan.Id, plan.Name, plan.Notes, plan.CreatedAt, plan.UpdatedAt,
        plan.RecommendationScopePlaylistId,
        plan.Tracks.Select(MixPlanTrackDto.From).ToList());
}
