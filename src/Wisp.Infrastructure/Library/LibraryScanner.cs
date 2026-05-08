using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.ArtistRefresh;
using Wisp.Infrastructure.FileSystem;
using Wisp.Infrastructure.Persistence;
using Wisp.Infrastructure.Tagging;

namespace Wisp.Infrastructure.Library;

public class LibraryScanner(
    WispDbContext db,
    IFileScanner fileScanner,
    IFileFingerprint fingerprint,
    IMetadataReader metadata,
    ScanProgressBus progress,
    ILogger<LibraryScanner> log)
{
    /// Scan throttling — emit progress at most this often during scanning.
    private static readonly TimeSpan ProgressInterval = TimeSpan.FromMilliseconds(250);

    public async Task RunAsync(ScanRequest request, CancellationToken cancellationToken)
    {
        var job = await db.ScanJobs.FirstOrDefaultAsync(s => s.Id == request.ScanJobId, cancellationToken)
                  ?? throw new InvalidOperationException($"ScanJob {request.ScanJobId} not found");

        job.Status = ScanStatus.Running;
        job.StartedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        Emit(job);

        try
        {
            // 1. Enumerate.
            var files = fileScanner.EnumerateAudioFiles(request.FolderPath).ToList();
            job.TotalFiles = files.Count;
            await db.SaveChangesAsync(cancellationToken);
            Emit(job);

            // 2. Index existing tracks under this root by FilePath.
            var rootPrefix = NormalizeRoot(request.FolderPath);
            var existingByPath = await db.Tracks
                .Where(t => EF.Functions.Like(t.FilePath, rootPrefix + "%"))
                .ToDictionaryAsync(t => t.FilePath, StringComparer.OrdinalIgnoreCase, cancellationToken);
            var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // 3. Process each file.
            var stopwatch = Stopwatch.StartNew();
            foreach (var path in files)
            {
                cancellationToken.ThrowIfCancellationRequested();
                seenPaths.Add(path);

                try
                {
                    var hash = await fingerprint.ComputeAsync(path, cancellationToken);

                    if (existingByPath.TryGetValue(path, out var existing))
                    {
                        if (existing.FileHash == hash)
                        {
                            existing.LastScannedAt = DateTime.UtcNow;
                        }
                        else
                        {
                            ApplyMetadata(existing, path, hash);
                            job.UpdatedTracks++;
                        }
                    }
                    else
                    {
                        var track = new Track
                        {
                            Id = Guid.NewGuid(),
                            FilePath = path,
                            FileName = Path.GetFileName(path),
                            FileHash = hash,
                            AddedAt = DateTime.UtcNow,
                        };
                        ApplyMetadata(track, path, hash);
                        db.Tracks.Add(track);
                        job.AddedTracks++;
                    }

                    job.ScannedFiles++;
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    log.LogWarning(ex, "Failed to process {Path}", path);
                    job.SkippedFiles++;
                }

                if (stopwatch.Elapsed >= ProgressInterval)
                {
                    await db.SaveChangesAsync(cancellationToken);
                    Emit(job);
                    stopwatch.Restart();
                }
            }

            // 4. Anything under root we didn't see → removed.
            foreach (var (storedPath, storedTrack) in existingByPath)
            {
                if (!seenPaths.Contains(storedPath))
                {
                    db.Tracks.Remove(storedTrack);
                    job.RemovedTracks++;
                }
            }

            job.Status = ScanStatus.Completed;
            job.CompletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            Emit(job);
            log.LogInformation(
                "Scan {Id} complete: {Added} added, {Updated} updated, {Removed} removed, {Skipped} skipped",
                job.Id, job.AddedTracks, job.UpdatedTracks, job.RemovedTracks, job.SkippedFiles);

            // Reconcile the user's Wanted wishlist against the freshly-scanned
            // library. Anything wanted that now exists locally gets a
            // MatchedLocalTrackId stamp (visible in the UI as a ✓ in library
            // chip on the Wanted page). Best-effort — failure here doesn't
            // un-do the scan.
            try
            {
                await ReconcileWantedTracksAsync(cancellationToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Wanted-track reconciliation after scan {Id} failed", job.Id);
            }
        }
        catch (OperationCanceledException)
        {
            job.Status = ScanStatus.Cancelled;
            job.CompletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(CancellationToken.None);
            Emit(job);
            throw;
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Scan {Id} failed", job.Id);
            job.Status = ScanStatus.Failed;
            job.Error = ex.Message;
            job.CompletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(CancellationToken.None);
            Emit(job);
        }
        finally
        {
            progress.Complete(job.Id);
        }
    }

    /// Walks the unmatched WantedTrack rows and stamps MatchedLocalTrackId
    /// when a local Track matches by normalized (Artist, Title). The Wanted
    /// page surfaces a "✓ in library" chip on stamped rows; the entry itself
    /// isn't deleted (the user might want to keep it visible until they
    /// hit Hide-found).
    private async Task ReconcileWantedTracksAsync(CancellationToken ct)
    {
        var unmatched = await db.WantedTracks
            .Where(w => w.MatchedLocalTrackId == null)
            .ToListAsync(ct);
        if (unmatched.Count == 0) return;

        // Build a lookup from the local library: (normalizedArtist, normalizedTitle) → Track.Id.
        // TitleOverlap.Normalize already strips bracketed mix names + folds accents
        // so "Burnin' (Extended Mix)" and "Burnin'" collapse to the same key.
        var locals = await db.Tracks
            .AsNoTracking()
            .Where(t => t.Artist != null && t.Title != null && !t.IsArchived)
            .Select(t => new { t.Id, t.Artist, t.Title })
            .ToListAsync(ct);

        var lookup = new Dictionary<(string artist, string title), Guid>();
        foreach (var t in locals)
        {
            var key = (ArtistNormalizer.Normalize(t.Artist!), TitleOverlap.Normalize(t.Title!));
            if (string.IsNullOrEmpty(key.Item1) || string.IsNullOrEmpty(key.Item2)) continue;
            lookup.TryAdd(key, t.Id);
        }

        var now = DateTime.UtcNow;
        var matched = 0;
        foreach (var w in unmatched)
        {
            var key = (ArtistNormalizer.Normalize(w.Artist), TitleOverlap.Normalize(w.Title));
            if (lookup.TryGetValue(key, out var trackId))
            {
                w.MatchedLocalTrackId = trackId;
                w.MatchedAt = now;
                matched++;
            }
        }
        if (matched > 0)
        {
            await db.SaveChangesAsync(ct);
            log.LogInformation("Wanted-track reconcile: {Matched} of {Unmatched} now in library", matched, unmatched.Count);
        }
    }

    private void ApplyMetadata(Track track, string path, string hash)
    {
        var meta = metadata.Read(path);

        track.FilePath = path;
        track.FileName = Path.GetFileName(path);
        track.FileHash = hash;

        track.Artist = meta.Artist;
        track.Title = meta.Title;
        track.Version = meta.Version;
        track.Album = meta.Album;
        track.Genre = meta.Genre;
        track.Bpm = meta.Bpm;
        track.MusicalKey = meta.MusicalKey;
        track.Energy = meta.Energy;
        track.ReleaseYear = meta.ReleaseYear;
        track.Duration = meta.Duration;
        track.IsMissingMetadata = meta.IsMissingMetadata;
        track.IsDirtyName = LooksDirty(track.FileName);
        track.LastScannedAt = DateTime.UtcNow;
    }

    private static bool LooksDirty(string filename)
    {
        var n = Path.GetFileNameWithoutExtension(filename);
        return n.Contains("320kbps", StringComparison.OrdinalIgnoreCase)
            || n.Contains("free download", StringComparison.OrdinalIgnoreCase)
            || n.Contains("(copy)", StringComparison.OrdinalIgnoreCase)
            || n.Contains("(final)", StringComparison.OrdinalIgnoreCase)
            || n.Contains('_');
    }

    private static string NormalizeRoot(string folder)
    {
        var full = Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar);
        // SQLite LIKE is case-sensitive by default for non-ASCII; the LIKE prefix is just a coarse filter,
        // we re-check exact case-insensitively in the dictionary anyway.
        return full + Path.DirectorySeparatorChar;
    }

    private void Emit(ScanJob job) => progress.Publish(new ScanProgress(
        job.Id, job.Status, job.TotalFiles, job.ScannedFiles,
        job.AddedTracks, job.UpdatedTracks, job.RemovedTracks, job.SkippedFiles, job.Error));
}
