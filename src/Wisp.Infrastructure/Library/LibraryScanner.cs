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
    ILogger<LibraryScanner> log,
    PortableTrackIdentity? identity = null)
{
    /// Scan throttling — emit progress at most this often during scanning.
    private static readonly TimeSpan ProgressInterval = TimeSpan.FromMilliseconds(250);

    public async Task RunAsync(ScanRequest request, CancellationToken cancellationToken)
    {
        await LibraryFileGate.Instance.WaitAsync(cancellationToken);
        try { await RunCoreAsync(request, cancellationToken); }
        finally { LibraryFileGate.Instance.Release(); }
    }

    private async Task RunCoreAsync(ScanRequest request, CancellationToken cancellationToken)
    {
        var job = await db.ScanJobs.FirstOrDefaultAsync(s => s.Id == request.ScanJobId, cancellationToken)
                  ?? throw new InvalidOperationException($"ScanJob {request.ScanJobId} not found");

        job.Status = ScanStatus.Running;
        job.StartedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        Emit(job);

        try
        {
            var activeIdentity = identity?.IsAvailable == true ? identity : null;
            if (identity is not null && activeIdentity is null)
                log.LogWarning("Portable identity initialisation deferred: FFmpeg is unavailable. Scanning metadata only.");
            // 1. Enumerate.
            var files = fileScanner.EnumerateAudioFiles(request.FolderPath).ToList();
            job.TotalFiles = files.Count;
            await db.SaveChangesAsync(cancellationToken);
            Emit(job);

            // 2. Index existing tracks under this root by FilePath.
            var rootPrefix = NormalizeRoot(request.FolderPath);
            var allTracks = await db.Tracks.ToListAsync(cancellationToken);
            var existingByPath = allTracks.Where(t => t.FilePath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
                .ToDictionary(t => t.FilePath, StringComparer.OrdinalIgnoreCase);
            var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var versions = await db.Tracks.Where(t => t.OriginalFilePath != null || t.NormalizedFilePath != null)
                .Select(t => new { t.FilePath, t.OriginalFilePath, t.NormalizedFilePath }).ToListAsync(cancellationToken);
            var inactivePaths = versions.SelectMany(t => new[] { t.OriginalFilePath, t.NormalizedFilePath }
                    .Where(p => p != null && !string.Equals(p, t.FilePath, StringComparison.OrdinalIgnoreCase)))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            // Generated files are deliberately excluded from discovery. Still
            // check the active copy's availability without re-importing metadata.
            foreach (var (path, track) in existingByPath)
                if (Wisp.Infrastructure.Audio.LoudnessNormalizer.IsGeneratedPath(path) && File.Exists(path))
                { seenPaths.Add(path); track.IsUnavailable = false; track.UnavailableSince = null; }

            // Recover renamed/retagged files BEFORE importing new paths. A new
            // filename must not orphan the original row's cues and playlist entries.
            var recovery = new TrackRenameRecoveryService(db, fingerprint, metadata,
                Microsoft.Extensions.Logging.Abstractions.NullLogger<TrackRenameRecoveryService>.Instance, activeIdentity);
            var recoveryPlan = await recovery.PlanAsync(allTracks, allTracks, files, cancellationToken);
            var deferredPaths = recoveryPlan.AmbiguousPaths.ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var match in recoveryPlan.Matches)
            {
                var oldPath = match.Track.FilePath;
                try
                {
                    if (!await recovery.ApplyAsync(match, cancellationToken))
                    { deferredPaths.Add(match.File.Path); continue; }
                    existingByPath.Remove(oldPath);
                    existingByPath.Add(match.File.Path, match.Track);
                    job.UpdatedTracks++;
                    log.LogInformation("Recovered renamed track {Id}: {OldPath} -> {Path} ({Reason})",
                        match.Track.Id, oldPath, match.File.Path, match.Reason);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                { deferredPaths.Add(match.File.Path); log.LogWarning(ex, "Rename recovery deferred for {Path}", match.File.Path); }
            }
            // 3. Process each file.
            var stopwatch = Stopwatch.StartNew();
            foreach (var path in files)
            {
                cancellationToken.ThrowIfCancellationRequested();
                seenPaths.Add(path);
                if (deferredPaths.Contains(path))
                {
                    // Neither guess at the identity nor import a duplicate of a
                    // prepared missing track. Explicit relink remains available.
                    job.SkippedFiles++;
                    log.LogWarning("Ambiguous rename: use Relink audio file to resolve {Path}", path);
                    continue;
                }
                if (inactivePaths.Contains(path) || Wisp.Infrastructure.Audio.LoudnessNormalizer.IsGeneratedPath(path))
                { job.SkippedFiles++; continue; }

                try
                {
                    var hash = await fingerprint.ComputeAsync(path, cancellationToken);

                    if (existingByPath.TryGetValue(path, out var existing))
                    {
                        // Verify/stamp the established row before a tag refresh can
                        // replace curated metadata or bind different audio at this path.
                        var previousHash = existing.FileHash;
                        if (activeIdentity is not null) await activeIdentity.EnsureAsync(existing, cancellationToken);
                        var refreshedHash = await fingerprint.ComputeAsync(path, cancellationToken);
                        existing.FileModifiedAt = File.GetLastWriteTimeUtc(path);
                        // The file is back after being unavailable (for example, an
                        // external drive was reconnected). Preserve its stable Wisp
                        // identity and all associated prep work.
                        existing.IsUnavailable = false;
                        existing.UnavailableSince = null;
                        if (previousHash == hash && hash == refreshedHash)
                        {
                            existing.LastScannedAt = DateTime.UtcNow;
                        }
                        else
                        {
                            // Tag-only identity writes must not overwrite curated text.
                            var analysis = metadata.Read(path);
                            existing.Bpm = analysis.Bpm ?? existing.Bpm;
                            existing.MusicalKey = analysis.MusicalKey ?? existing.MusicalKey;
                            existing.Energy = analysis.Energy ?? existing.Energy;
                            existing.FileHash = refreshedHash;
                            existing.LastScannedAt = DateTime.UtcNow;
                            job.UpdatedTracks++;
                        }
                    }
                    else
                    {
                        var portable = activeIdentity is null ? null : await activeIdentity.ReadAsync(path, cancellationToken);
                        if (portable?.Conflict == true || portable?.TrackId is { } owner && allTracks.Any(t => t.Id == owner))
                        {
                            job.SkippedFiles++;
                            log.LogWarning("Copied or conflicting WISP identity; review file {Path}", path);
                            continue;
                        }
                        var track = new Track
                        {
                            Id = portable?.TrackId ?? Guid.NewGuid(),
                            FilePath = path,
                            FileName = Path.GetFileName(path),
                            FileHash = hash,
                            AddedAt = DateTime.UtcNow,
                        };
                        ApplyMetadata(track, path, hash);
                        if (activeIdentity is not null) await activeIdentity.EnsureAsync(track, cancellationToken);
                        db.Tracks.Add(track);
                        allTracks.Add(track);
                        existingByPath.Add(path, track);
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

            // 4. Anything under root we didn't see is unavailable, not deleted.
            // Deleting a Track cascades through CuePoints, Playlists, MixPlans and
            // tags. A partial scan, network hiccup or moved USB must never erase
            // the DJ's preparation data.
            foreach (var (storedPath, storedTrack) in existingByPath)
            {
                if (!seenPaths.Contains(storedPath))
                {
                    storedTrack.IsUnavailable = true;
                    storedTrack.UnavailableSince ??= DateTime.UtcNow;
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
        track.FileModifiedAt = File.GetLastWriteTimeUtc(path);

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
