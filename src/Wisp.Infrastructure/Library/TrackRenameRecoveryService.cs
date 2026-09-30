using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Wisp.Core.Cleanup;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.FileSystem;
using Wisp.Infrastructure.Persistence;
using Wisp.Infrastructure.Tagging;

namespace Wisp.Infrastructure.Library;

public sealed class TrackRenameRecoveryService(WispDbContext db, IFileFingerprint fingerprint,
    IMetadataReader metadata, ILogger<TrackRenameRecoveryService> log)
{
    /// Bounded playback recovery: look only beside the old file, not across all drives.
    /// Rescan provides the broader, library-root search for unchanged files moved elsewhere.
    public async Task<Track?> TryRecoverForPlaybackAsync(Guid id, CancellationToken ct)
    {
        await LibraryFileGate.Instance.WaitAsync(ct);
        try
        {
            var all = await db.Tracks.ToListAsync(ct);
            var track = all.FirstOrDefault(t => t.Id == id);
            if (track is null || File.Exists(track.FilePath)) return track;
            var directory = Path.GetDirectoryName(track.FilePath);
            if (directory is null || !Directory.Exists(directory)) return null;
            var scoped = all.Where(t => string.Equals(Path.GetDirectoryName(t.FilePath), directory, StringComparison.OrdinalIgnoreCase));
            var files = Directory.EnumerateFiles(directory).Where(FileScanner.IsAudioFile);
            var plan = await PlanAsync(all, scoped, files, ct);
            var match = plan.Matches.SingleOrDefault(m => m.Track.Id == id);
            return match is not null && await ApplyAsync(match, ct) ? track : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        { log.LogWarning(ex, "Playback rename recovery deferred for track {Id}", id); return null; }
        finally { LibraryFileGate.Instance.Release(); }
    }

    // Caller owns LibraryFileGate (or is the offline maintenance tool with WISP closed).
    public async Task<TrackRenamePlan> PlanAsync(IReadOnlyList<Track> allTracks,
        IEnumerable<Track> scopedTracks, IEnumerable<string> files, CancellationToken ct)
    {
        var missing = scopedTracks.Where(t => !File.Exists(t.FilePath)
            && !Wisp.Infrastructure.Audio.LoudnessNormalizer.IsGeneratedPath(t.FilePath)).ToArray();
        if (missing.Length == 0) return new([], new HashSet<string>());
        var claimed = allTracks.SelectMany(t => new[] { t.FilePath, t.OriginalFilePath, t.NormalizedFilePath })
            .Where(p => p is not null).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var candidates = new List<RecoveryFile>();
        foreach (var path in files.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            ct.ThrowIfCancellationRequested();
            if (claimed.Contains(path) || Wisp.Infrastructure.Audio.LoudnessNormalizer.IsGeneratedPath(path)) continue;
            try
            {
                // Do not inspect a moving target while another application writes tags.
                using var handle = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                candidates.Add(new(path, await fingerprint.ComputeAsync(path, ct), metadata.Read(path)));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            { log.LogWarning(ex, "Could not inspect rename recovery candidate {Path}", path); }
        }
        return TrackRenameRecovery.Plan(missing, candidates);
    }

    public async Task<bool> ApplyAsync(TrackRenameMatch match, CancellationToken ct)
    {
        if (File.Exists(match.Track.FilePath)) return false;
        using var handle = new FileStream(match.File.Path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (await fingerprint.ComputeAsync(match.File.Path, ct) != match.File.Hash) return false;
        var audits = await db.MetadataAuditLogs.Where(a => a.TrackId == match.Track.Id && a.Status == CleanupStatus.Applied).ToListAsync(ct);
        TrackRenameRecovery.Apply(match);
        foreach (var audit in audits)
        {
            audit.Status = CleanupStatus.Superseded;
            audit.FailureReason = "Undo disabled: file renamed outside WISP and its existing link recovered.";
        }
        await db.SaveChangesAsync(ct);
        return true;
    }
}
