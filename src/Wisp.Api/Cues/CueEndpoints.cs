using Microsoft.EntityFrameworkCore;
using Wisp.Core.Cues;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Cues;

public static class CueEndpoints
{
    public static IEndpointRouteBuilder MapCues(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/tracks/{trackId:guid}/cues", List);
        app.MapPost("/api/tracks/{trackId:guid}/cues", Create);
        app.MapPost("/api/tracks/{trackId:guid}/cues/phrase-markers", GeneratePhraseMarkers);
        app.MapPatch("/api/cues/{id:guid}", Update);
        app.MapDelete("/api/cues/{id:guid}", Delete);
        return app;
    }

    private static async Task<IResult> List(Guid trackId, WispDbContext db, CancellationToken ct)
    {
        var cues = await db.CuePoints.AsNoTracking()
            .Where(c => c.TrackId == trackId)
            .OrderBy(c => c.TimeSeconds)
            .ToListAsync(ct);
        return Results.Ok(cues.Select(CuePointDto.From));
    }

    private static async Task<IResult> Create(
        Guid trackId, CreateCueRequest body, WispDbContext db, CancellationToken ct)
    {
        if (!await db.Tracks.AnyAsync(t => t.Id == trackId, ct)) return Results.NotFound();
        if (body.TimeSeconds < 0)
            return Results.BadRequest(new { code = "invalid_time", message = "TimeSeconds must be >= 0." });

        var cue = new CuePoint
        {
            Id = Guid.NewGuid(),
            TrackId = trackId,
            TimeSeconds = body.TimeSeconds,
            Type = body.Type,
            Label = string.IsNullOrWhiteSpace(body.Label) ? body.Type.ToString() : body.Label.Trim(),
            IsAutoSuggested = body.IsAutoSuggested,
            CreatedAt = DateTime.UtcNow,
        };
        db.CuePoints.Add(cue);
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/cues/{cue.Id}", CuePointDto.From(cue));
    }

    private static async Task<IResult> Update(
        Guid id, UpdateCueRequest body, WispDbContext db, CancellationToken ct)
    {
        var cue = await db.CuePoints.FindAsync([id], ct);
        if (cue is null) return Results.NotFound();

        if (body.TimeSeconds.HasValue)
        {
            if (body.TimeSeconds < 0)
                return Results.BadRequest(new { code = "invalid_time", message = "TimeSeconds must be >= 0." });
            cue.TimeSeconds = body.TimeSeconds.Value;
        }
        if (body.Label is not null) cue.Label = body.Label.Trim();
        if (body.Type.HasValue) cue.Type = body.Type.Value;

        // Manual edit demotes an auto-suggested marker to "approved".
        cue.IsAutoSuggested = false;

        await db.SaveChangesAsync(ct);
        return Results.Ok(CuePointDto.From(cue));
    }

    private static async Task<IResult> Delete(Guid id, WispDbContext db, CancellationToken ct)
    {
        var cue = await db.CuePoints.FindAsync([id], ct);
        if (cue is null) return Results.NotFound();
        db.CuePoints.Remove(cue);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> GeneratePhraseMarkers(
        Guid trackId, GeneratePhraseMarkersRequest body, WispDbContext db, CancellationToken ct)
    {
        var track = await db.Tracks.AsNoTracking().FirstOrDefaultAsync(t => t.Id == trackId, ct);
        if (track is null) return Results.NotFound();
        if (track.Bpm is not { } bpm)
            return Results.BadRequest(new { code = "no_bpm", message = "Track has no BPM tag; cannot compute phrase markers." });

        if (body.ReplaceExisting)
        {
            var stale = db.CuePoints.Where(c => c.TrackId == trackId && c.IsAutoSuggested);
            db.CuePoints.RemoveRange(stale);
        }

        var now = DateTime.UtcNow;
        var generated = PhraseMarkers
            .Generate(body.FirstBeatSeconds, bpm, track.Duration.TotalSeconds, body.StepBeats)
            .Select(m => new CuePoint
            {
                Id = Guid.NewGuid(),
                TrackId = trackId,
                TimeSeconds = m.TimeSeconds,
                Label = m.Label,
                Type = CuePointType.Custom,
                IsAutoSuggested = true,
                CreatedAt = now,
            })
            .ToList();

        db.CuePoints.AddRange(generated);
        await db.SaveChangesAsync(ct);

        return Results.Ok(generated.Select(CuePointDto.From));
    }
}
