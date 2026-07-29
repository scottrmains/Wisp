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
        app.MapDelete("/api/tracks/{trackId:guid}/cues", DeleteAllForTrack);
        app.MapGet("/api/tracks/{trackId:guid}/device-cues", ListDeviceCues);
        app.MapPost("/api/tracks/{trackId:guid}/device-cues", CreateDeviceCue);
        app.MapPost("/api/cues/{id:guid}/promote-to-device-cue", PromoteCue);
        app.MapPatch("/api/device-cues/{id:guid}", UpdateDeviceCue);
        app.MapDelete("/api/device-cues/{id:guid}", DeleteDeviceCue);
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

    private static async Task<IResult> DeleteAllForTrack(Guid trackId, WispDbContext db, CancellationToken ct)
    {
        if (!await db.Tracks.AnyAsync(t => t.Id == trackId, ct)) return Results.NotFound();
        var rows = await db.CuePoints.Where(c => c.TrackId == trackId).ExecuteDeleteAsync(ct);
        return Results.Ok(new { deleted = rows });
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

    private static async Task<IResult> ListDeviceCues(Guid trackId, WispDbContext db, CancellationToken ct)
    {
        var cues = await db.DeviceCues.AsNoTracking()
            .Where(c => c.TrackId == trackId)
            .OrderBy(c => c.StartSeconds)
            .ToListAsync(ct);
        return Results.Ok(cues.Select(DeviceCueDto.From));
    }

    private static async Task<IResult> PromoteCue(Guid id, WispDbContext db, CancellationToken ct)
    {
        var source = await db.CuePoints.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id, ct);
        if (source is null) return Results.NotFound();

        var existing = await db.DeviceCues.FirstOrDefaultAsync(c => c.SourceCuePointId == id, ct);
        if (existing is not null) return Results.Ok(DeviceCueDto.From(existing));

        var cue = new DeviceCue
        {
            Id = Guid.NewGuid(),
            TrackId = source.TrackId,
            Kind = DeviceCueKind.MemoryCue,
            StartSeconds = source.TimeSeconds,
            Comment = string.IsNullOrWhiteSpace(source.Label) ? null : source.Label.Trim(),
            SourceCuePointId = source.Id,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        db.DeviceCues.Add(cue);
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/device-cues/{cue.Id}", DeviceCueDto.From(cue));
    }

    private static async Task<IResult> CreateDeviceCue(
        Guid trackId, CreateDeviceCueRequest body, WispDbContext db, CancellationToken ct)
    {
        var track = await db.Tracks.AsNoTracking().FirstOrDefaultAsync(t => t.Id == trackId, ct);
        if (track is null) return Results.NotFound();
        var error = ValidateDeviceCue(body.Kind, body.StartSeconds, body.EndSeconds, track.Duration.TotalSeconds);
        if (error is not null) return Results.BadRequest(new { code = "invalid_device_cue", message = error });

        var now = DateTime.UtcNow;
        var cue = new DeviceCue
        {
            Id = Guid.NewGuid(), TrackId = trackId, Kind = body.Kind,
            StartSeconds = body.StartSeconds, EndSeconds = body.EndSeconds,
            Comment = TrimComment(body.Comment), SourceCuePointId = body.SourceCuePointId,
            CreatedAt = now, UpdatedAt = now,
        };
        db.DeviceCues.Add(cue);
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/device-cues/{cue.Id}", DeviceCueDto.From(cue));
    }

    private static async Task<IResult> UpdateDeviceCue(
        Guid id, UpdateDeviceCueRequest body, WispDbContext db, CancellationToken ct)
    {
        var cue = await db.DeviceCues.Include(c => c.Track).FirstOrDefaultAsync(c => c.Id == id, ct);
        if (cue is null) return Results.NotFound();

        var kind = body.Kind ?? cue.Kind;
        var start = body.StartSeconds ?? cue.StartSeconds;
        // A supplied null EndSeconds means "leave unchanged" here. Removing a loop end is
        // intentionally done by changing the kind to MemoryCue, keeping PATCH unambiguous.
        var end = body.EndSeconds ?? cue.EndSeconds;
        var error = ValidateDeviceCue(kind, start, end, cue.Track?.Duration.TotalSeconds ?? double.PositiveInfinity);
        if (error is not null) return Results.BadRequest(new { code = "invalid_device_cue", message = error });

        cue.Kind = kind;
        cue.StartSeconds = start;
        cue.EndSeconds = kind == DeviceCueKind.MemoryCue ? null : end;
        if (body.Comment is not null) cue.Comment = TrimComment(body.Comment);
        cue.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return Results.Ok(DeviceCueDto.From(cue));
    }

    private static async Task<IResult> DeleteDeviceCue(Guid id, WispDbContext db, CancellationToken ct)
    {
        var cue = await db.DeviceCues.FindAsync([id], ct);
        if (cue is null) return Results.NotFound();
        db.DeviceCues.Remove(cue);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static string? ValidateDeviceCue(DeviceCueKind kind, double start, double? end, double duration)
    {
        if (!Enum.IsDefined(kind)) return "Unknown device cue kind.";
        if (!double.IsFinite(start) || start < 0) return "Cue start must be a finite value at or after 0 seconds.";
        if (start > duration) return "Cue start cannot be after the end of the track.";
        if (kind == DeviceCueKind.Loop)
        {
            if (end is null || !double.IsFinite(end.Value) || end <= start)
                return "A loop needs an end time after its start.";
            if (end > duration) return "Loop end cannot be after the end of the track.";
        }
        return null;
    }

    private static string? TrimComment(string? comment) => string.IsNullOrWhiteSpace(comment) ? null : comment.Trim()[..Math.Min(200, comment.Trim().Length)];
}
