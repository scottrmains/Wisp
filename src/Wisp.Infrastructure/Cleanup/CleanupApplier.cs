using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Wisp.Core.Cleanup;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Persistence;
using TagFile = TagLib.File;

namespace Wisp.Infrastructure.Cleanup;

public class CleanupApplier(
    WispDbContext db,
    CleanupSuggestionService suggestions,
    ILogger<CleanupApplier> log)
{
    public CleanupSuggestion Preview(Track track) => suggestions.Suggest(track);

    public async Task<(MetadataAuditLog Audit, CleanupSuggestion Applied)> ApplyAsync(Guid trackId, CancellationToken ct)
    {
        var track = await db.Tracks.FirstOrDefaultAsync(t => t.Id == trackId, ct)
            ?? throw new InvalidOperationException($"Track {trackId} not found");

        var suggestion = suggestions.Suggest(track);
        if (!suggestion.HasChanges)
            throw new InvalidOperationException("Nothing to clean up — track is already tidy.");

        if (!File.Exists(track.FilePath))
            throw new FileNotFoundException($"File no longer on disk: {track.FilePath}");

        var before = suggestion.Before;
        var after = suggestion.After;

        // Resolve filename collision: append " (2)", " (3)", ... if necessary.
        var resolvedPath = ResolveCollision(after.FilePath, currentPath: track.FilePath);
        if (resolvedPath != after.FilePath)
        {
            after = after with { FilePath = resolvedPath, FileName = Path.GetFileName(resolvedPath) };
        }

        var audit = new MetadataAuditLog
        {
            Id = Guid.NewGuid(),
            TrackId = trackId,
            Action = CleanupAction.Cleanup,
            Status = CleanupStatus.Applied,
            BeforeJson = JsonSerializer.Serialize(before),
            AfterJson = JsonSerializer.Serialize(after),
            FilePathBefore = before.FilePath,
            FilePathAfter = after.FilePath,
            CreatedAt = DateTime.UtcNow,
        };

        try
        {
            // 1. Write tags in-place against the *original* path. If this fails the file is unchanged.
            WriteTags(track.FilePath, after);

            // 2. Rename if needed. If this fails, roll back the tag write so we end up where we started.
            if (!string.Equals(track.FilePath, after.FilePath, StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    File.Move(track.FilePath, after.FilePath);
                }
                catch
                {
                    log.LogWarning("Rename failed after tag write; reverting tags on {Path}", track.FilePath);
                    try { WriteTags(track.FilePath, before); }
                    catch (Exception ex) { log.LogError(ex, "Tag rollback also failed; manual recovery needed"); }
                    throw;
                }
            }

            // 3. Update DB row.
            track.FilePath = after.FilePath;
            track.FileName = after.FileName;
            track.Artist = after.Artist;
            track.Title = after.Title;
            track.Version = after.Version;
            track.Album = after.Album;
            track.Genre = after.Genre;
            track.IsDirtyName = false;
            track.IsMissingMetadata = string.IsNullOrEmpty(after.Artist) || string.IsNullOrEmpty(after.Title);
            track.LastScannedAt = DateTime.UtcNow;

            db.MetadataAuditLogs.Add(audit);
            await db.SaveChangesAsync(ct);
            return (audit, suggestion with { After = after });
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Cleanup failed for track {Id}", trackId);
            audit.Status = CleanupStatus.Failed;
            audit.FailureReason = ex.Message;
            db.MetadataAuditLogs.Add(audit);
            try { await db.SaveChangesAsync(ct); } catch { /* don't mask the real error */ }
            throw;
        }
    }

    public async Task<MetadataAuditLog> UndoAsync(Guid auditId, CancellationToken ct)
    {
        var audit = await db.MetadataAuditLogs.FirstOrDefaultAsync(a => a.Id == auditId, ct)
            ?? throw new InvalidOperationException($"Audit {auditId} not found");

        if (audit.Status != CleanupStatus.Applied)
            throw new InvalidOperationException($"Cannot undo audit in state {audit.Status}");

        var before = JsonSerializer.Deserialize<TrackSnapshot>(audit.BeforeJson)
            ?? throw new InvalidOperationException("Audit Before snapshot is malformed");

        var currentPath = audit.FilePathAfter;
        if (!File.Exists(currentPath))
            throw new FileNotFoundException($"File no longer on disk: {currentPath}");

        try
        {
            // 1. Rename back if needed.
            if (!string.Equals(currentPath, before.FilePath, StringComparison.OrdinalIgnoreCase))
            {
                if (File.Exists(before.FilePath))
                    throw new InvalidOperationException($"Cannot restore: a different file already occupies {before.FilePath}");
                File.Move(currentPath, before.FilePath);
            }

            // 2. Revert tags.
            WriteTags(before.FilePath, before);

            // 3. Update DB row if track still exists.
            var track = await db.Tracks.FirstOrDefaultAsync(t => t.Id == audit.TrackId, ct);
            if (track is not null)
            {
                track.FilePath = before.FilePath;
                track.FileName = before.FileName;
                track.Artist = before.Artist;
                track.Title = before.Title;
                track.Version = before.Version;
                track.Album = before.Album;
                track.Genre = before.Genre;
                track.LastScannedAt = DateTime.UtcNow;
            }

            audit.Status = CleanupStatus.RolledBack;
            await db.SaveChangesAsync(ct);
            return audit;
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Undo failed for audit {Id}", auditId);
            throw;
        }
    }

    private static void WriteTags(string path, TrackSnapshot snapshot)
    {
        using var file = TagFile.Create(path);
        var tag = file.Tag;

        tag.Performers = string.IsNullOrWhiteSpace(snapshot.Artist) ? [] : [snapshot.Artist];
        tag.AlbumArtists = tag.Performers;

        // Bake version back into the title for compatibility with other DJ tools that
        // only read Tag.Title. MetadataReader extracts it again on the next scan.
        tag.Title = string.IsNullOrWhiteSpace(snapshot.Version)
            ? snapshot.Title
            : $"{snapshot.Title} ({snapshot.Version})";

        tag.Subtitle = snapshot.Version;
        tag.Album = snapshot.Album;
        tag.Genres = string.IsNullOrWhiteSpace(snapshot.Genre) ? [] : [snapshot.Genre];

        file.Save();
    }

    /// If `target` already exists (and isn't `currentPath`), try " (2)", " (3)", ... up to (99).
    private static string ResolveCollision(string target, string currentPath)
    {
        if (string.Equals(target, currentPath, StringComparison.OrdinalIgnoreCase)) return target;
        if (!File.Exists(target)) return target;

        var dir = Path.GetDirectoryName(target) ?? "";
        var name = Path.GetFileNameWithoutExtension(target);
        var ext = Path.GetExtension(target);

        for (var i = 2; i <= 99; i++)
        {
            var candidate = Path.Combine(dir, $"{name} ({i}){ext}");
            if (string.Equals(candidate, currentPath, StringComparison.OrdinalIgnoreCase)) return candidate;
            if (!File.Exists(candidate)) return candidate;
        }
        throw new IOException($"Could not find a free filename for {target}");
    }
}
