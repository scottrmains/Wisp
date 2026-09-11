using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Wisp.Api.Settings;
using Wisp.Core.Cleanup;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.FileSystem;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Library;

public sealed record TrackLoudnessAnalysis(Guid Id, string SourcePath, string SourceHash, long SourceLength,
    DateTime SourceModifiedAt, double TargetLufs, LoudnessMeasurement Measurement, DateTime ScannedAt);
public sealed record TrackNormalization(Guid AnalysisId, string SourceHash, string OutputHash, string OutputPath,
    double TargetLufs, double GainDb, bool Limited, LoudnessMeasurement Measurement, DateTime CreatedAt,
    bool BoostOnly = false, Guid? ReferenceTrackId = null, string? ReferenceTitle = null, string? ReferenceSourceHash = null);
public sealed record LoudnessState(TrackDto Track, TrackLoudnessAnalysis? Analysis, TrackNormalization? Normalization,
    string OriginalPath, bool OriginalExists, bool NormalizedExists, bool AnalysisStale);

public static class LoudnessEndpoints
{
    public sealed record ScanRequest(double TargetLufs = -14);
    public sealed record CreateRequest(Guid AnalysisId, string MusicFolder, bool AllowLimiting = false,
        bool BoostOnly = true, Guid? ReferenceTrackId = null, Guid? ReferenceAnalysisId = null);
    public sealed record SwitchRequest(string Version, string ExpectedFilePath);
    public sealed record StatusRequest(IReadOnlyList<Guid>? TrackIds);

    public static IEndpointRouteBuilder MapLoudness(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/loudness/settings", (WispSettingsStore settings, ILoudnessNormalizer normalizer) => Results.Ok(new {
            musicFolder = settings.Current.NormalizationMusicFolder ?? settings.Current.LastFolder,
            available = normalizer.IsAvailable, outputFolderName = LoudnessNormalizer.FolderName,
        }));
        app.MapGet("/api/tracks/{id:guid}/loudness", async (Guid id, WispDbContext db, CancellationToken ct) =>
            await db.Tracks.FindAsync([id], ct) is { } t ? Results.Ok(State(t)) : Results.NotFound());
        app.MapPost("/api/loudness/status", async (StatusRequest body, WispDbContext db, CancellationToken ct) => {
            if (body.TrackIds is null || body.TrackIds.Count is < 1 or > 20000) return Results.BadRequest(new { message = "Select between 1 and 20,000 tracks." });
            var ids = body.TrackIds.Distinct().ToArray();
            var rows = await db.Tracks.AsNoTracking().Where(t => ids.Contains(t.Id)).ToListAsync(ct);
            if (rows.Count != ids.Length) return Results.NotFound(new { message = "Some selected tracks were removed. Close this dialog and select the tracks again." });
            var order = ids.Select((id, index) => (id, index)).ToDictionary(x => x.id, x => x.index);
            return Results.Ok(rows.OrderBy(t => order[t.Id]).Select(State));
        });
        app.MapPost("/api/tracks/{id:guid}/loudness/scan", Scan);
        app.MapPost("/api/tracks/{id:guid}/loudness/create", Create);
        app.MapPut("/api/tracks/{id:guid}/loudness/version", Switch);
        app.MapGet("/api/tracks/{id:guid}/loudness/preview", Preview);
        return app;
    }

    private static T? Read<T>(string? json) where T : class
    {
        try { return json is null ? null : JsonSerializer.Deserialize<T>(json); }
        catch (JsonException) { return null; } // Corrupt analysis can be rescanned; never invent measurements.
    }
    private static string Original(Track t) => t.OriginalFilePath ?? t.FilePath;
    private static bool Same(string? a, string? b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    private static LoudnessState State(Track t)
    {
        var analysis = Read<TrackLoudnessAnalysis>(t.LoudnessAnalysisJson);
        var file = new FileInfo(Original(t));
        return new(TrackDto.From(t), analysis, Read<TrackNormalization>(t.NormalizationJson), Original(t), file.Exists,
            t.NormalizedFilePath is not null && File.Exists(t.NormalizedFilePath),
            analysis is not null && (!file.Exists || !Same(analysis.SourcePath, file.FullName) ||
                file.Length != analysis.SourceLength || file.LastWriteTimeUtc != analysis.SourceModifiedAt));
    }

    private static async Task<string> Hash(string path, CancellationToken ct)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.Asynchronous);
        return Convert.ToHexString(await SHA256.HashDataAsync(stream, ct));
    }

    private static async Task<IResult> Guard(Func<Task<IResult>> action, CancellationToken ct)
    {
        if (!await LibraryFileGate.Instance.WaitAsync(0, ct))
            return Results.Conflict(new { code = "library_busy", message = "A library scan or file operation is running. Wait for it to finish, then retry." });
        try { return await action(); }
        catch (TranscodeException ex) { return Results.UnprocessableEntity(new { code = "loudness_failed", message = ex.Message }); }
        catch (IOException) { return Results.Conflict(new { code = "file_unavailable", message = "A file is missing, busy, or the drive is full/unavailable. Your original has not been overwritten." }); }
        catch (UnauthorizedAccessException) { return Results.BadRequest(new { message = "WISP cannot access this folder or audio file. Check its permissions." }); }
        catch (ArgumentException) { return Results.BadRequest(new { message = "The file or folder path is invalid. Choose an existing music folder." }); }
        finally { LibraryFileGate.Instance.Release(); }
    }

    private static Task<IResult> Scan(Guid id, ScanRequest body, WispDbContext db, ILoudnessNormalizer normalizer, CancellationToken ct) => Guard(async () =>
    {
        if (!LoudnessNormalizer.ValidTarget(body.TargetLufs))
            return Results.BadRequest(new { message = "Choose a target between -30 and -5 LUFS." });
        var track = await db.Tracks.FindAsync([id], ct);
        if (track is null) return Results.NotFound();
        var source = Original(track);
        await using var file = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read);
        var measurement = await normalizer.MeasureAsync(source, body.TargetLufs, ct);
        track.LoudnessAnalysisJson = JsonSerializer.Serialize(new TrackLoudnessAnalysis(Guid.NewGuid(), source,
            await Hash(source, ct), file.Length, File.GetLastWriteTimeUtc(source), body.TargetLufs, measurement, DateTime.UtcNow));
        await db.SaveChangesAsync(ct);
        return Results.Ok(State(track));
    }, ct);

    private static Task<IResult> Create(Guid id, CreateRequest body, WispDbContext db, ILoudnessNormalizer normalizer,
        WispSettingsStore settings, CancellationToken ct) => Guard(async () =>
    {
        var track = await db.Tracks.FindAsync([id], ct);
        if (track is null) return Results.NotFound();
        var analysis = Read<TrackLoudnessAnalysis>(track.LoudnessAnalysisJson);
        if (analysis is null || analysis.Id != body.AnalysisId || !Same(analysis.SourcePath, Original(track)))
            return Results.Conflict(new { code = "analysis_stale", message = "Scan this track again before creating a normalised copy." });
        if (!LoudnessNormalizer.ValidTarget(analysis.TargetLufs))
            return Results.Conflict(new { code = "analysis_stale", message = "Choose a supported target and scan again." });
        Track? reference = null;
        TrackLoudnessAnalysis? referenceAnalysis = null;
        if (body.ReferenceTrackId.HasValue != body.ReferenceAnalysisId.HasValue)
            return Results.BadRequest(new { message = "Measure the reference track before creating copies." });
        if (body.ReferenceTrackId is { } referenceId)
        {
            if (referenceId == id) return Results.Conflict(new { code = "no_change", message = "The reference track stays unchanged." });
            reference = await db.Tracks.FindAsync([referenceId], ct);
            referenceAnalysis = reference is null ? null : Read<TrackLoudnessAnalysis>(reference.LoudnessAnalysisJson);
            if (reference is null || referenceAnalysis is null || referenceAnalysis.Id != body.ReferenceAnalysisId ||
                State(reference).AnalysisStale || !File.Exists(Original(reference)) ||
                await Hash(Original(reference), ct) != referenceAnalysis.SourceHash ||
                Math.Abs(referenceAnalysis.Measurement.IntegratedLufs - analysis.TargetLufs) > 0.001)
                return Results.Conflict(new { code = "reference_stale", message = "The reference or target changed. Measure the reference again, then rescan the selected tracks." });
        }
        var plan = LoudnessNormalizer.Plan(analysis.Measurement, analysis.TargetLufs, body.BoostOnly, body.AllowLimiting);
        if (!plan.CanCreate)
            return Results.Conflict(new { code = plan.Action == "needs-limiting" ? "limiting_required" : "no_change",
                message = plan.Action == "needs-limiting" ? "Cannot boost safely without limiting. Leave this track unchanged, or explicitly allow limiting and preview the new copy."
                    : body.BoostOnly ? "This track is already loud enough or needs no adjustment. Boost-only never turns it down."
                    : "These settings produce no useful gain change. If the track is still quiet, consider optional limiting." });
        if (Same(track.FilePath, track.NormalizedFilePath))
            return Results.Conflict(new { message = "Switch to the original before creating another normalised version." });
        if (string.IsNullOrWhiteSpace(body.MusicFolder) || !Path.IsPathFullyQualified(body.MusicFolder) || !Directory.Exists(body.MusicFolder))
            return Results.BadRequest(new { message = "Choose an existing main music folder using its full path." });
        var root = Path.GetFullPath(body.MusicFolder);
        if (LoudnessNormalizer.IsGeneratedPath(root))
            return Results.BadRequest(new { message = "Choose your main music folder, not the generated WISP Normalized folder." });
        var folder = Path.Combine(root, LoudnessNormalizer.FolderName, track.Id.ToString("N"));
        // Refuse junction/symlink destinations instead of writing outside the
        // selected tree. Never derive directories from track titles/metadata.
        for (var dir = new DirectoryInfo(folder); dir is not null; dir = dir.Parent)
            if (dir.Exists && (dir.Attributes & FileAttributes.ReparsePoint) != 0)
                return Results.BadRequest(new { message = "Choose a physical music folder, not a junction or symbolic link." });
        await using var source = new FileStream(analysis.SourcePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (await Hash(analysis.SourcePath, ct) != analysis.SourceHash)
            return Results.Conflict(new { code = "analysis_stale", message = "The original audio changed after the scan. Scan again; nothing was created." });
        var previous = Read<TrackNormalization>(track.NormalizationJson);
        if (previous is not null && previous.AnalysisId == analysis.Id && previous.Limited == plan.Limited &&
            previous.BoostOnly == body.BoostOnly && previous.ReferenceTrackId == body.ReferenceTrackId && previous.ReferenceSourceHash == referenceAnalysis?.SourceHash &&
            Same(Path.GetDirectoryName(previous.OutputPath), folder) && File.Exists(previous.OutputPath) && await Hash(previous.OutputPath, ct) == previous.OutputHash)
            return Results.Ok(State(track)); // Lost-response retry must not make another copy.

        settings.Update(s => s with { NormalizationMusicFolder = root });
        Directory.CreateDirectory(folder);
        var name = string.Concat(Path.GetFileNameWithoutExtension(analysis.SourcePath).Where(c => !Path.GetInvalidFileNameChars().Contains(c)));
        if (name.Length > 80) name = name[..80];
        var output = Path.Combine(folder, $"{name} - normalized-{Guid.NewGuid():N}.wav");
        var committed = false;
        try
        {
            var tags = new Dictionary<string, string> { ["comment"] = $"WISP normalised version; original retained; target {analysis.TargetLufs} LUFS" };
            if (track.Title is { } title) tags["title"] = title;
            if (track.Artist is { } artist) tags["artist"] = artist;
            if (track.Album is { } album) tags["album"] = album;
            if (track.Genre is { } genre) tags["genre"] = genre;
            var rendered = await normalizer.RenderAsync(analysis.SourcePath, output, analysis.Measurement, analysis.TargetLufs, body.AllowLimiting, tags, ct);
            // Re-measurement must confirm a real improvement, not just a planned
            // positive gain. Never link a quieter/no-op copy in boost-only mode.
            if (body.BoostOnly && rendered.Output.IntegratedLufs <= analysis.Measurement.IntegratedLufs + 0.05)
                throw new TranscodeException("This copy did not become louder. It was discarded; the original and previous version are unchanged. Try a different reference or target.");
            var info = new TrackNormalization(analysis.Id, analysis.SourceHash, await Hash(output, ct), output,
                analysis.TargetLufs, rendered.GainDb, rendered.Limited, rendered.Output, DateTime.UtcNow,
                body.BoostOnly, reference?.Id, reference?.Title ?? reference?.FileName, referenceAnalysis?.SourceHash);
            // Save only version fields: track metadata, memberships and all cues remain.
            track.OriginalFilePath = analysis.SourcePath;
            track.NormalizedFilePath = output;
            track.NormalizationJson = JsonSerializer.Serialize(info);
            await db.SaveChangesAsync(ct);
            committed = true;
            return Results.Ok(State(track));
        }
        finally
        {
            // Only this operation's unique generated file can be removed on failure.
            // Never touch the source or previously successful versions.
            if (!committed && File.Exists(output)) File.Delete(output);
        }
    }, ct);

    private static Task<IResult> Switch(Guid id, SwitchRequest body, WispDbContext db, IFileFingerprint fingerprint,
        IAudioFileValidator validator, CancellationToken ct) => Guard(async () =>
    {
        if (body.Version is not ("original" or "normalized")) return Results.BadRequest(new { message = "Choose Original or Normalised." });
        var track = await db.Tracks.FindAsync([id], ct);
        if (track is null) return Results.NotFound();
        if (!Same(track.FilePath, body.ExpectedFilePath)) return Results.Conflict(new { message = "The active file changed. Reopen the loudness dialog and try again." });
        var path = body.Version == "original" ? Original(track) : track.NormalizedFilePath;
        if (path is null) return Results.BadRequest(new { message = "Create a normalised copy first." });
        await using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (body.Version == "normalized")
        {
            var info = Read<TrackNormalization>(track.NormalizationJson);
            if (info is null || await Hash(path, ct) != info.OutputHash ||
                (File.Exists(Original(track)) && await Hash(Original(track), ct) != info.SourceHash))
                return Results.Conflict(new { code = "version_stale", message = "An audio file changed. Scan the original and create a new normalised copy before switching." });
        }
        var duration = await validator.ValidateAsync(path, ct);
        track.FilePath = path; track.FileName = Path.GetFileName(path);
        track.FileHash = await fingerprint.ComputeAsync(path, ct);
        track.FileModifiedAt = File.GetLastWriteTimeUtc(path); track.Duration = duration;
        track.IsUnavailable = false; track.UnavailableSince = null;
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await db.MetadataAuditLogs.Where(a => a.TrackId == id && a.Status == CleanupStatus.Applied)
            .ExecuteUpdateAsync(s => s.SetProperty(a => a.Status, CleanupStatus.Superseded)
                .SetProperty(a => a.FailureReason, "Undo disabled: active audio version changed."), ct);
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
        return Results.Ok(State(track));
    }, ct);

    private static async Task<IResult> Preview(Guid id, string version, WispDbContext db, AiffTranscoder transcoder,
        ILogger<AiffTranscoder> log, CancellationToken ct)
    {
        var track = await db.Tracks.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id, ct);
        if (track is null) return Results.NotFound();
        if (version is not ("original" or "normalized")) return Results.BadRequest();
        var path = version == "original" ? Original(track) : track.NormalizedFilePath;
        if (path is null || !File.Exists(path)) return Results.NotFound();
        return await LibraryEndpoints.StreamTrackAudio(new Track { FilePath = path, FileHash = await Hash(path, ct) }, transcoder, log, ct);
    }
}
