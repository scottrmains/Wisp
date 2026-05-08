using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;
using Wisp.Core.Recommendations;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Library;

public static class LibraryEndpoints
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() }
    };

    public static IEndpointRouteBuilder MapLibrary(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/library");

        g.MapPost("/scan", StartScan);
        g.MapGet("/scan/{id:guid}", GetScan);
        g.MapGet("/scan/{id:guid}/events", StreamScan);

        var tracks = app.MapGroup("/api/tracks");
        tracks.MapGet("", ListTracks);
        tracks.MapGet("{id:guid}", GetTrack);
        tracks.MapGet("{id:guid}/audio", StreamAudio);
        tracks.MapGet("{id:guid}/recommendations", GetRecommendations);
        tracks.MapPut("{id:guid}/notes", UpdateNotes);
        tracks.MapPost("{id:guid}/archive", ArchiveTrack);
        tracks.MapPost("{id:guid}/restore", RestoreTrack);
        // Original-file download for cross-process drag (Rekordbox/Explorer/etc).
        // Distinct from /audio because (a) it serves the original AIFF instead of the transcoded
        // WAV, and (b) it sends Content-Disposition: attachment so Chromium's DownloadURL
        // mechanism + Explorer's "Save As" both pick a sensible filename.
        tracks.MapGet("{id:guid}/download", DownloadOriginal);

        return app;
    }

    private static async Task<IResult> DownloadOriginal(Guid id, WispDbContext db, CancellationToken ct)
    {
        var track = await db.Tracks.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id, ct);
        if (track is null) return Results.NotFound();
        if (!File.Exists(track.FilePath))
            return Results.Problem(
                title: "File not found on disk",
                detail: track.FilePath,
                statusCode: StatusCodes.Status410Gone);

        // Build a friendly download name from tag metadata; fall back to the on-disk filename.
        var ext = Path.GetExtension(track.FilePath);
        var preferred = !string.IsNullOrWhiteSpace(track.Artist) && !string.IsNullOrWhiteSpace(track.Title)
            ? $"{track.Artist} - {track.Title}{ext}"
            : track.FileName;
        // Strip filesystem-reserved characters so Explorer accepts the suggested name.
        var safeName = string.Concat(preferred.Where(c => !Path.GetInvalidFileNameChars().Contains(c)));

        var contentType = ContentTypeFor(track.FilePath);
        var etag = EntityTagHeaderValue.Parse($"\"{track.FileHash}\"");
        var lastModified = File.GetLastWriteTimeUtc(track.FilePath);

        return Results.File(
            track.FilePath,
            contentType: contentType,
            fileDownloadName: safeName,
            lastModified: lastModified,
            entityTag: etag,
            enableRangeProcessing: true);
    }

    private record ArchiveRequest(string Reason);

    private static async Task<IResult> ArchiveTrack(Guid id, ArchiveRequest body, WispDbContext db, CancellationToken ct)
    {
        var t = await db.Tracks.FindAsync([id], ct);
        if (t is null) return Results.NotFound();
        if (!Enum.TryParse<Wisp.Core.Tracks.ArchiveReason>(body.Reason, ignoreCase: true, out var reason))
            return Results.BadRequest(new { code = "invalid_reason", message = $"Unknown archive reason '{body.Reason}'." });
        t.IsArchived = true;
        t.ArchivedAt = DateTime.UtcNow;
        t.ArchiveReason = reason;
        await db.SaveChangesAsync(ct);
        return Results.Ok(TrackDto.From(t));
    }

    private static async Task<IResult> RestoreTrack(Guid id, WispDbContext db, CancellationToken ct)
    {
        var t = await db.Tracks.FindAsync([id], ct);
        if (t is null) return Results.NotFound();
        t.IsArchived = false;
        t.ArchivedAt = null;
        t.ArchiveReason = null;
        await db.SaveChangesAsync(ct);
        return Results.Ok(TrackDto.From(t));
    }

    private record UpdateNotesRequest(string? Notes);

    private static async Task<IResult> UpdateNotes(Guid id, UpdateNotesRequest body, WispDbContext db, CancellationToken ct)
    {
        var t = await db.Tracks.FindAsync([id], ct);
        if (t is null) return Results.NotFound();
        // Treat empty / whitespace as "clear" so we don't accumulate empty strings.
        t.Notes = string.IsNullOrWhiteSpace(body.Notes) ? null : body.Notes.Trim();
        await db.SaveChangesAsync(ct);
        return Results.Ok(TrackDto.From(t));
    }

    private static async Task<IResult> StreamAudio(
        Guid id,
        WispDbContext db,
        AiffTranscoder transcoder,
        ILogger<AiffTranscoder> log,
        CancellationToken ct)
    {
        var track = await db.Tracks.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id, ct);
        if (track is null) return Results.NotFound();
        if (!File.Exists(track.FilePath))
            return Results.Problem(
                title: "File not found on disk",
                detail: track.FilePath,
                statusCode: StatusCodes.Status410Gone);

        // Determine which file we'll actually stream. AIFF gets routed through the transcoder
        // because Chromium's <audio> element has no native AIFF decoder; everything else streams
        // straight from the source file. The transcoder is cache-aware so first play is the only
        // one that pays the conversion cost.
        string streamPath;
        string contentType;
        if (AiffTranscoder.IsTranscodeNeeded(track.FilePath))
        {
            try
            {
                streamPath = await transcoder.GetOrCreateAsync(track.FilePath, track.FileHash, ct);
                contentType = "audio/wav";
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "AIFF transcode failed for {Path}", track.FilePath);
                return Results.Problem(
                    title: "Transcode failed",
                    detail: $"Could not convert AIFF to WAV: {ex.Message}",
                    statusCode: StatusCodes.Status500InternalServerError);
            }
        }
        else
        {
            streamPath = track.FilePath;
            contentType = ContentTypeFor(track.FilePath);
        }

        // ETag stays bound to the source's hash so range requests + cache validators stay
        // consistent across plays — even though the bytes on disk are the cached WAV, they
        // represent the same source audio identity.
        var etag = EntityTagHeaderValue.Parse($"\"{track.FileHash}\"");
        var lastModified = File.GetLastWriteTimeUtc(streamPath);

        return Results.File(
            streamPath,
            contentType: contentType,
            fileDownloadName: null,
            lastModified: lastModified,
            entityTag: etag,
            enableRangeProcessing: true);
    }

    private static string ContentTypeFor(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".mp3" => "audio/mpeg",
        ".wav" => "audio/wav",
        ".flac" => "audio/flac",
        ".m4a" => "audio/mp4",
        ".ogg" => "audio/ogg",
        ".opus" => "audio/opus",
        // AIFF served as audio/wav after going through AiffTranscoder; this fallback only fires
        // if something hits ContentTypeFor for an AIFF without going through the transcode path.
        ".aiff" or ".aif" => "audio/aiff",
        _ => "application/octet-stream",
    };

    private static async Task<IResult> GetRecommendations(
        Guid id,
        WispDbContext db,
        RecommendationService svc,
        string? mode = "Safe",
        int limit = 50,
        // Optional: restrict the candidate pool to tracks in the given playlist.
        // Set automatically by the Mix Plans page when the active plan has a scope.
        Guid? scopePlaylistId = null,
        CancellationToken ct = default)
    {
        var seed = await db.Tracks.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id, ct);
        if (seed is null) return Results.NotFound();

        if (!Enum.TryParse<RecommendationMode>(mode, ignoreCase: true, out var parsedMode))
            return Results.BadRequest(new { code = "invalid_mode", message = $"Unknown mode '{mode}'." });

        // Block-pair filter (Phase 15c): any track the user has rated `Bad` against the seed
        // (in either direction) gets pulled out of the candidate pool entirely. Self-healing —
        // re-rating the pair from the blend modal removes the block.
        var blockedIds = await db.BlendRatings
            .AsNoTracking()
            .Where(r => r.Rating == Wisp.Core.Feedback.BlendRatingValue.Bad
                && (r.TrackAId == id || r.TrackBId == id))
            .Select(r => r.TrackAId == id ? r.TrackBId : r.TrackAId)
            .ToListAsync(ct);
        var blockedSet = new HashSet<Guid>(blockedIds);

        // "Maybe"-rated pairs aren't blocked — just chip-marked in the UI so the user knows
        // why a particular candidate is ranked where it is.
        var maybeIds = await db.BlendRatings
            .AsNoTracking()
            .Where(r => r.Rating == Wisp.Core.Feedback.BlendRatingValue.Maybe
                && (r.TrackAId == id || r.TrackBId == id))
            .Select(r => r.TrackAId == id ? r.TrackBId : r.TrackAId)
            .ToListAsync(ct);
        var maybeSet = new HashSet<Guid>(maybeIds);

        // Candidate pool: tracks with at least a key OR a BPM (so the score can be non-zero).
        // Archived tracks are pulled out so retired material doesn't keep getting recommended.
        // When scopePlaylistId is set, the candidate pool is further restricted to playlist members
        // — the user's "build me a House Night set, but only suggest from these candidates" lever.
        var candidatesQuery = db.Tracks.AsNoTracking()
            .Where(t => t.Id != id && !t.IsArchived && (t.MusicalKey != null || t.Bpm != null));
        if (scopePlaylistId.HasValue && scopePlaylistId.Value != Guid.Empty)
        {
            var pid = scopePlaylistId.Value;
            candidatesQuery = candidatesQuery.Where(t =>
                db.PlaylistTracks.Any(pt => pt.PlaylistId == pid && pt.TrackId == t.Id));
        }
        var candidates = await candidatesQuery.ToListAsync(ct);
        candidates = candidates.Where(c => !blockedSet.Contains(c.Id)).ToList();

        limit = Math.Clamp(limit, 1, 200);

        var ranked = svc.Rank(seed, candidates, parsedMode, limit)
            .Select(r => new RecommendationDto(
                TrackDto.From(r.Track),
                r.Score.Total,
                r.Score.KeyScore,
                r.Score.BpmScore,
                r.Score.EnergyScore,
                r.Score.GenreScore,
                r.Score.Penalties,
                r.Score.Reasons,
                PreviousRating: maybeSet.Contains(r.Track.Id) ? "Maybe" : null))
            .ToList();

        return Results.Ok(ranked);
    }

    private static async Task<IResult> StartScan(
        StartScanRequest body,
        WispDbContext db,
        ScanQueue queue,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.FolderPath))
            return Results.BadRequest(new { code = "folder_required", message = "FolderPath is required." });
        if (!Directory.Exists(body.FolderPath))
            return Results.BadRequest(new { code = "folder_not_found", message = $"Folder not found: {body.FolderPath}" });

        var job = new ScanJob
        {
            Id = Guid.NewGuid(),
            FolderPath = Path.GetFullPath(body.FolderPath),
            Status = ScanStatus.Pending,
            StartedAt = DateTime.UtcNow,
        };
        db.ScanJobs.Add(job);
        await db.SaveChangesAsync(ct);
        await queue.EnqueueAsync(new ScanRequest(job.Id, job.FolderPath), ct);

        return Results.Accepted($"/api/library/scan/{job.Id}", ScanJobDto.From(job));
    }

    private static async Task<IResult> GetScan(Guid id, WispDbContext db, CancellationToken ct)
    {
        var job = await db.ScanJobs.FindAsync([id], ct);
        return job is null ? Results.NotFound() : Results.Ok(ScanJobDto.From(job));
    }

    private static async Task StreamScan(
        Guid id,
        HttpContext ctx,
        WispDbContext db,
        ScanProgressBus bus,
        CancellationToken ct)
    {
        var job = await db.ScanJobs.FindAsync([id], ct);
        if (job is null)
        {
            ctx.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        ctx.Response.Headers.ContentType = "text/event-stream";
        ctx.Response.Headers.CacheControl = "no-cache";
        ctx.Response.Headers.Connection = "keep-alive";
        // disable response buffering for SSE
        ctx.Response.Headers["X-Accel-Buffering"] = "no";

        // Replay current state immediately so a late subscriber catches up.
        await WriteEvent(ctx, ScanProgressFor(job), ct);

        if (job.Status is ScanStatus.Completed or ScanStatus.Failed or ScanStatus.Cancelled)
            return;

        await foreach (var p in bus.SubscribeAsync(id, ct))
        {
            await WriteEvent(ctx, p, ct);
            if (p.Status is ScanStatus.Completed or ScanStatus.Failed or ScanStatus.Cancelled)
                break;
        }
    }

    private static async Task WriteEvent(HttpContext ctx, ScanProgress p, CancellationToken ct)
    {
        var payload = JsonSerializer.Serialize(p, Json);
        await ctx.Response.WriteAsync($"data: {payload}\n\n", ct);
        await ctx.Response.Body.FlushAsync(ct);
    }

    private static ScanProgress ScanProgressFor(ScanJob s) => new(
        s.Id, s.Status, s.TotalFiles, s.ScannedFiles,
        s.AddedTracks, s.UpdatedTracks, s.RemovedTracks, s.SkippedFiles, s.Error);

    private static async Task<IResult> ListTracks(
        WispDbContext db,
        string? search = null,
        string? key = null,
        decimal? bpmMin = null,
        decimal? bpmMax = null,
        int? energyMin = null,
        int? energyMax = null,
        bool? missing = null,
        string? sort = null,
        // Archive controls — default behaviour is "active library only".
        // includeArchived=true → mix Active + Archived. archivedOnly=true → only Archived.
        bool includeArchived = false,
        bool archivedOnly = false,
        // Tag filter — repeat ?tag=warm-up&tag=vocal for AND across multiple tags.
        string[]? tag = null,
        // Playlist scope — restrict to tracks that belong to the given playlist.
        Guid? playlistId = null,
        int page = 1,
        int size = 100,
        CancellationToken ct = default)
    {
        if (page < 1) page = 1;
        size = Math.Clamp(size, 1, 1000);

        IQueryable<Track> q = db.Tracks.AsNoTracking();

        // Archive filter — by default we exclude soft-archived tracks from the library
        // view + from the recommendation candidate pool. Caller has to opt in to see them.
        if (archivedOnly) q = q.Where(t => t.IsArchived);
        else if (!includeArchived) q = q.Where(t => !t.IsArchived);

        // Tag filter — intersection (track must have ALL requested tags). Done as a sequence
        // of `Any` clauses so EF turns each into an EXISTS subquery against TrackTags.
        if (tag is { Length: > 0 })
        {
            foreach (var name in tag.Where(n => !string.IsNullOrWhiteSpace(n)))
            {
                var trimmed = name.Trim();
                q = q.Where(t => db.TrackTags.Any(tt => tt.TrackId == t.Id && tt.Name == trimmed));
            }
        }

        // Playlist scope — restrict to tracks that are members of the given playlist.
        // EXISTS subquery via the join table; composes cleanly with the other filters.
        if (playlistId.HasValue && playlistId.Value != Guid.Empty)
        {
            var pid = playlistId.Value;
            q = q.Where(t => db.PlaylistTracks.Any(pt => pt.PlaylistId == pid && pt.TrackId == t.Id));
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            q = q.Where(t =>
                (t.Artist != null && EF.Functions.Like(t.Artist, $"%{s}%")) ||
                (t.Title != null && EF.Functions.Like(t.Title, $"%{s}%")) ||
                (t.Album != null && EF.Functions.Like(t.Album, $"%{s}%")));
        }

        if (!string.IsNullOrWhiteSpace(key))
            q = q.Where(t => t.MusicalKey == key);

        if (bpmMin.HasValue) q = q.Where(t => t.Bpm >= bpmMin);
        if (bpmMax.HasValue) q = q.Where(t => t.Bpm <= bpmMax);
        if (energyMin.HasValue) q = q.Where(t => t.Energy >= energyMin);
        if (energyMax.HasValue) q = q.Where(t => t.Energy <= energyMax);
        if (missing == true) q = q.Where(t => t.IsMissingMetadata);

        // Camelot key sort: map "1A, 1B, 2A, 2B … 12A, 12B" → 1..24 so 9A < 9B < 10A.
        // For non-Camelot strings (rare; tracks with raw key tags) the CASE returns 99
        // and they fall to the end. Composing OrderBy on this CASE expression is fine
        // for SQLite at single-user scale; if it becomes hot, materialise into a column.
        IOrderedQueryable<Track> KeyOrder(IQueryable<Track> source, bool descending)
        {
            // SQLite: substr(key, 1, 1) handles "1A", "9B"; substr(key, 1, 2) handles "10A", "12B".
            // We match against the literal codes to keep this provider-agnostic.
            var ordered = source.OrderBy(t =>
                t.MusicalKey == "1A" ? 1 : t.MusicalKey == "1B" ? 2 :
                t.MusicalKey == "2A" ? 3 : t.MusicalKey == "2B" ? 4 :
                t.MusicalKey == "3A" ? 5 : t.MusicalKey == "3B" ? 6 :
                t.MusicalKey == "4A" ? 7 : t.MusicalKey == "4B" ? 8 :
                t.MusicalKey == "5A" ? 9 : t.MusicalKey == "5B" ? 10 :
                t.MusicalKey == "6A" ? 11 : t.MusicalKey == "6B" ? 12 :
                t.MusicalKey == "7A" ? 13 : t.MusicalKey == "7B" ? 14 :
                t.MusicalKey == "8A" ? 15 : t.MusicalKey == "8B" ? 16 :
                t.MusicalKey == "9A" ? 17 : t.MusicalKey == "9B" ? 18 :
                t.MusicalKey == "10A" ? 19 : t.MusicalKey == "10B" ? 20 :
                t.MusicalKey == "11A" ? 21 : t.MusicalKey == "11B" ? 22 :
                t.MusicalKey == "12A" ? 23 : t.MusicalKey == "12B" ? 24 :
                99);
            return descending
                ? source.OrderByDescending(t =>
                    t.MusicalKey == "1A" ? 1 : t.MusicalKey == "1B" ? 2 :
                    t.MusicalKey == "2A" ? 3 : t.MusicalKey == "2B" ? 4 :
                    t.MusicalKey == "3A" ? 5 : t.MusicalKey == "3B" ? 6 :
                    t.MusicalKey == "4A" ? 7 : t.MusicalKey == "4B" ? 8 :
                    t.MusicalKey == "5A" ? 9 : t.MusicalKey == "5B" ? 10 :
                    t.MusicalKey == "6A" ? 11 : t.MusicalKey == "6B" ? 12 :
                    t.MusicalKey == "7A" ? 13 : t.MusicalKey == "7B" ? 14 :
                    t.MusicalKey == "8A" ? 15 : t.MusicalKey == "8B" ? 16 :
                    t.MusicalKey == "9A" ? 17 : t.MusicalKey == "9B" ? 18 :
                    t.MusicalKey == "10A" ? 19 : t.MusicalKey == "10B" ? 20 :
                    t.MusicalKey == "11A" ? 21 : t.MusicalKey == "11B" ? 22 :
                    t.MusicalKey == "12A" ? 23 : t.MusicalKey == "12B" ? 24 :
                    99)
                : ordered;
        }

        // SQLite's default puts NULLs first on ascending sort, which means a paged query
        // (size=500) fills up entirely with null-valued tracks before any real values appear.
        // For every nullable sort field we prefix `OrderBy(t => t.X == null)` (false before true)
        // so NULLs always sort to the END regardless of direction. Applies to both asc and desc
        // for consistency — null-BPM tracks belong at the bottom no matter which way you sort.
        q = (sort?.ToLowerInvariant()) switch
        {
            "artist" => q.OrderBy(t => t.Artist == null).ThenBy(t => t.Artist).ThenBy(t => t.Title),
            "-artist" => q.OrderBy(t => t.Artist == null).ThenByDescending(t => t.Artist).ThenByDescending(t => t.Title),
            "title" => q.OrderBy(t => t.Title == null).ThenBy(t => t.Title),
            "-title" => q.OrderBy(t => t.Title == null).ThenByDescending(t => t.Title),
            "bpm" => q.OrderBy(t => t.Bpm == null).ThenBy(t => t.Bpm),
            "-bpm" => q.OrderBy(t => t.Bpm == null).ThenByDescending(t => t.Bpm),
            "energy" => q.OrderBy(t => t.Energy == null).ThenBy(t => t.Energy),
            "-energy" => q.OrderBy(t => t.Energy == null).ThenByDescending(t => t.Energy),
            // KeyOrder's inline CASE already returns 99 for null/non-Camelot keys, so they
            // naturally sort last in both directions without an extra null-prefix.
            "key" => KeyOrder(q, descending: false).ThenBy(t => t.Artist),
            "-key" => KeyOrder(q, descending: true).ThenBy(t => t.Artist),
            "genre" => q.OrderBy(t => t.Genre == null).ThenBy(t => t.Genre).ThenBy(t => t.Artist),
            "-genre" => q.OrderBy(t => t.Genre == null).ThenByDescending(t => t.Genre).ThenBy(t => t.Artist),
            // Duration sort intentionally omitted: SQLite stores TimeSpan as TEXT and refuses to
            // ORDER BY it. Fixing properly requires a value converter (long ticks) + migration that
            // re-encodes existing data — not worth the schema churn for a column most users sort
            // by infrequently. Frontend should not expose a sortKey for the duration column.
            "year" => q.OrderBy(t => t.ReleaseYear == null).ThenBy(t => t.ReleaseYear),
            "-year" => q.OrderBy(t => t.ReleaseYear == null).ThenByDescending(t => t.ReleaseYear),
            "added" => q.OrderBy(t => t.AddedAt),
            "-added" => q.OrderByDescending(t => t.AddedAt),
            _ => q.OrderBy(t => t.Artist == null).ThenBy(t => t.Artist).ThenBy(t => t.Title),
        };

        var total = await q.CountAsync(ct);
        var items = await q.Skip((page - 1) * size).Take(size).ToListAsync(ct);

        return Results.Ok(new TrackPageDto(items.Select(TrackDto.From).ToList(), total, page, size));
    }

    private static async Task<IResult> GetTrack(Guid id, WispDbContext db, CancellationToken ct)
    {
        var t = await db.Tracks.FindAsync([id], ct);
        return t is null ? Results.NotFound() : Results.Ok(TrackDto.From(t));
    }
}
