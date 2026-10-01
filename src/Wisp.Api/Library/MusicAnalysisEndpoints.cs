using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Wisp.Core.Music;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Library;

public static class MusicAnalysisEndpoints
{
    public static IEndpointRouteBuilder MapMusicAnalysis(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/audio-analysis");
        group.MapGet("/status", (MusicAnalysisJobs jobs) => {
            var job = jobs.Active;
            return Results.Ok(new { available = jobs.Available, activeJob = job is null ? null : new { job.Id, job.Status } });
        });
        group.MapGet("/jobs/{id:guid}", (Guid id, MusicAnalysisJobs jobs) => jobs.Get(id) is { } job ? Results.Ok(job) : Results.NotFound());
        group.MapPost("/jobs", async (MusicAnalysisRequest body, MusicAnalysisJobs jobs, WispDbContext db, CancellationToken ct) => {
            if (body.TrackIds is null || body.TrackIds.Count is < 1 or > 20000 || (!body.Bpm && !body.Key))
                return Results.BadRequest(new { message = "Select 1–20,000 tracks and choose BPM, key or both." });
            if (!jobs.Available) return Results.BadRequest(new { message = "FFmpeg is unavailable. Check its path in Settings." });
            var ids = body.TrackIds.Distinct().ToArray();
            var tracks = await db.Tracks.AsNoTracking().Where(t => ids.Contains(t.Id)).ToListAsync(ct);
            if (tracks.Count != ids.Length) return Results.NotFound(new { message = "Some selected tracks were removed. Select the tracks again." });
            var order = ids.Select((id, i) => (id, i)).ToDictionary(x => x.id, x => x.i);
            var job = jobs.Start(body, tracks.OrderBy(t => order[t.Id]).ToArray());
            return job is null ? Results.Conflict(new { message = "An analysis is already running. Open its progress or cancel it first." }) : Results.Ok(job);
        });
        group.MapPost("/jobs/{id:guid}/cancel", (Guid id, MusicAnalysisJobs jobs) => jobs.Cancel(id) ? Results.NoContent() : Results.NotFound());
        group.MapPost("/jobs/{id:guid}/tracks/{trackId:guid}/apply", Apply);
        return app;
    }

    private static async Task<IResult> Apply(Guid id, Guid trackId, MusicAnalysisApply body,
        MusicAnalysisJobs jobs, WispDbContext db, CancellationToken ct)
    {
        var row = jobs.Get(id)?.Rows.FirstOrDefault(r => r.TrackId == trackId);
        if (row?.Status != "review" || row.Result is null || row.SourceHash is null)
            return Results.Conflict(new { message = "Analyse this track again before applying a suggestion." });
        // User can correct BPM (including half/double-time), but cannot invent an
        // unanalysed field or arbitrary key through the apply endpoint.
        if (body.Bpm is null && body.Key is null || body.Bpm is < 30 or > 400 ||
            body.Bpm is not null && (!row.BpmRequested || row.Result.Bpm is null) ||
            body.Key is not null && (!row.KeyRequested || row.Result.Key is null || body.Key != row.Result.Key || !Camelot.TryParse(body.Key, out _)))
            return Results.BadRequest(new { message = "Choose a suggested key or a reviewed BPM between 30 and 400." });
        if (!await LibraryFileGate.Instance.WaitAsync(0, ct))
            return Results.Conflict(new { message = "A library operation is running. Wait for it to finish, then apply again." });
        try
        {
            var track = await db.Tracks.FindAsync([trackId], ct);
            if (track is null) return Results.NotFound();
            if (track.FilePath != row.SourcePath)
                return Results.Conflict(new { message = "The linked audio changed. Analyse the track again." });
            await using var source = new FileStream(track.FilePath, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (await MusicAnalysisJobs.Hash(track.FilePath, ct) != row.SourceHash)
                return Results.Conflict(new { message = "The audio or its tags changed. Rescan and analyse again; nothing was applied." });
            var tags = MusicAnalysisJobs.Tags(track.FilePath);
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var bpmApplied = 0; var keyApplied = 0;
            if (body.Bpm is { } bpm && !MusicAnalysisJobs.HasBpm(tags.Bpm))
                bpmApplied = await db.Tracks.Where(t => t.Id == trackId && (t.Bpm == null || t.Bpm <= 0))
                    .ExecuteUpdateAsync(s => s.SetProperty(t => t.Bpm, Math.Round(bpm, 2)), ct);
            if (body.Key is { } key && !MusicAnalysisJobs.HasKey(tags.Key))
                keyApplied = await db.Tracks.Where(t => t.Id == trackId && (t.MusicalKey == null || t.MusicalKey.Trim() == ""))
                    .ExecuteUpdateAsync(s => s.SetProperty(t => t.MusicalKey, key), ct);
            var stored = MusicAnalysisJobs.Read(track.MusicAnalysisJson);
            if (stored is not null && stored.SourceHash == row.SourceHash && (bpmApplied + keyApplied > 0))
            {
                track.MusicAnalysisJson = JsonSerializer.Serialize(stored with {
                    AppliedBpm = bpmApplied > 0 ? Math.Round(body.Bpm!.Value, 2) : stored.AppliedBpm,
                    AppliedKey = keyApplied > 0 ? body.Key : stored.AppliedKey, AppliedAt = DateTime.UtcNow });
                await db.SaveChangesAsync(ct);
            }
            await transaction.CommitAsync(ct);
            // ExecuteUpdate bypasses the change tracker. Return fresh, never stale metadata.
            await db.Entry(track).ReloadAsync(ct);
            return Results.Ok(new { bpmApplied = bpmApplied > 0, keyApplied = keyApplied > 0,
                message = bpmApplied + keyApplied > 0 ? "Missing values applied to WISP. Audio files and cues are unchanged."
                    : "Existing values preserved; nothing was overwritten.", track = TrackDto.From(track) });
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or TagLib.CorruptFileException or TagLib.UnsupportedFormatException)
        { return Results.Conflict(new { message = "Cannot safely read this audio file. Close tag editors, check its drive and analyse again." }); }
        finally { LibraryFileGate.Instance.Release(); }
    }
}
