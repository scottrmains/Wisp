using Microsoft.EntityFrameworkCore;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.FileSystem;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;
using Wisp.Infrastructure.Tagging;

namespace Wisp.Api.Library;

public static class TrackFileEndpoints
{
    public sealed record RelinkRequest(string FilePath, string ExpectedFilePath);

    public static IEndpointRouteBuilder MapTrackFiles(this IEndpointRouteBuilder app)
    {
        app.MapPut("/api/tracks/{id:guid}/file", Relink);
        app.MapDelete("/api/tracks/{id:guid}", Remove);
        return app;
    }

    private static IResult Busy() => Results.Conflict(new { code = "library_busy", message = "A library scan or file change is running. Wait for it to finish, then try again." });

    private static async Task<IResult> Relink(Guid id, RelinkRequest body, WispDbContext db,
        IFileFingerprint fingerprint, IMetadataReader metadata, IAudioFileValidator validator, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.FilePath) || body.FilePath.Length > 32767 || !Path.IsPathFullyQualified(body.FilePath))
            return Results.BadRequest(new { code = "invalid_path", message = "Choose a local audio file using its full path." });
        string path;
        try { path = Path.GetFullPath(body.FilePath); }
        catch (ArgumentException) { return Results.BadRequest(new { message = "This file path is invalid." }); }
        if (!new[] { ".mp3", ".flac", ".wav", ".aiff", ".aif", ".m4a", ".ogg", ".opus" }.Contains(Path.GetExtension(path).ToLowerInvariant()))
            return Results.BadRequest(new { code = "unsupported_file", message = "Choose an MP3, FLAC, WAV, AIFF, M4A, OGG or Opus audio file." });
        if (!await LibraryFileGate.Instance.WaitAsync(0, ct)) return Busy();
        try
        {
            var track = await db.Tracks.FindAsync([id], ct);
            if (track is null) return Results.NotFound();
            if (!string.Equals(track.FilePath, body.ExpectedFilePath, StringComparison.OrdinalIgnoreCase))
                return Results.Conflict(new { code = "track_changed", message = "This track's file link changed. Close this dialog and reopen it before trying again." });
            // Compare case-insensitively even though the SQLite path index is case-sensitive.
            var paths = await db.Tracks.Where(t => t.Id != id).Select(t => t.FilePath).ToListAsync(ct);
            if (paths.Any(p => string.Equals(p, path, StringComparison.OrdinalIgnoreCase)))
                return Results.Conflict(new { code = "already_linked", message = "This file is already linked to another WISP track. No changes were made. Keep that entry, or remove it from WISP first after checking its cues and playlists." });
            if (!File.Exists(path)) return Results.BadRequest(new { code = "file_missing", message = "The selected file could not be found. Check that its drive is connected." });

            // Hold a read lock against replacement/tagging for validation + commit on Windows.
            await using var source = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            var duration = await validator.ValidateAsync(path, ct);
            var hash = await fingerprint.ComputeAsync(path, ct);
            var meta = metadata.Read(path);
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            track.FilePath = path;
            track.FileName = Path.GetFileName(path);
            track.FileHash = hash;
            track.Duration = duration;
            track.FileModifiedAt = File.GetLastWriteTimeUtc(path);
            track.LastScannedAt = DateTime.UtcNow;
            track.IsUnavailable = false;
            track.UnavailableSince = null;
            // Keep WISP's curated metadata; only fill fields that were absent.
            track.Artist ??= meta.Artist;
            track.Title ??= meta.Title;
            track.Version ??= meta.Version;
            track.Album ??= meta.Album;
            track.Genre ??= meta.Genre;
            track.Bpm ??= meta.Bpm;
            track.MusicalKey ??= meta.MusicalKey;
            track.Energy ??= meta.Energy;
            track.ReleaseYear ??= meta.ReleaseYear;
            track.IsMissingMetadata = string.IsNullOrWhiteSpace(track.Artist) || string.IsNullOrWhiteSpace(track.Title);
            // Old cleanup undo records refer to the previous physical file. They must not
            // rename it back over this replacement. Retain history but disable those undos.
            await db.MetadataAuditLogs.Where(a => a.TrackId == id && a.Status == Wisp.Core.Cleanup.CleanupStatus.Applied)
                .ExecuteUpdateAsync(s => s.SetProperty(a => a.Status, Wisp.Core.Cleanup.CleanupStatus.Superseded)
                    .SetProperty(a => a.FailureReason, "Undo disabled: audio file explicitly relinked."), ct);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return Results.Ok(TrackDto.From(track));
        }
        catch (TranscodeException ex) { return Results.UnprocessableEntity(new { code = "audio_unreadable", message = ex.Message }); }
        catch (IOException) { return Results.Conflict(new { code = "file_busy", message = "The file could not be read. Close any application modifying it, check the drive, and try again." }); }
        catch (UnauthorizedAccessException) { return Results.BadRequest(new { code = "file_access", message = "WISP does not have permission to read that file." }); }
        catch (DbUpdateException) { return Results.Conflict(new { code = "library_changed", message = "The library changed during this operation. Refresh and try again." }); }
        finally { LibraryFileGate.Instance.Release(); }
    }

    private static async Task<IResult> Remove(Guid id, WispDbContext db, CancellationToken ct)
    {
        if (!await LibraryFileGate.Instance.WaitAsync(0, ct)) return Busy();
        try
        {
            var track = await db.Tracks.FindAsync([id], ct);
            if (track is null) return Results.NotFound();
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.WantedTracks.Where(w => w.MatchedLocalTrackId == id)
                .ExecuteUpdateAsync(s => s.SetProperty(w => w.MatchedAt, (DateTime?)null), ct);
            await db.MetadataAuditLogs.Where(a => a.TrackId == id && a.Status == Wisp.Core.Cleanup.CleanupStatus.Applied)
                .ExecuteUpdateAsync(s => s.SetProperty(a => a.Status, Wisp.Core.Cleanup.CleanupStatus.Superseded)
                    .SetProperty(a => a.FailureReason, "Undo disabled: track explicitly removed from WISP."), ct);
            db.Tracks.Remove(track); // DB cascades only: no file system delete/move.
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return Results.NoContent();
        }
        finally { LibraryFileGate.Instance.Release(); }
    }
}
