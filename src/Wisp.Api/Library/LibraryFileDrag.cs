using Microsoft.EntityFrameworkCore;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Library;

/// Resolves existing library IDs, never accepts arbitrary file paths from web content.
public sealed class LibraryFileDrag(WispDbContext db)
{
    public const int MaxTracks = 20000;

    public string[] Resolve(IReadOnlyList<Guid> requested)
        => ResolveSelection(requested, allowInternalOnly: false).Paths;

    public sealed record Selection(Guid[] TrackIds, string[] Paths, int MissingCount);

    public Selection ResolveSelection(IReadOnlyList<Guid> requested, bool allowInternalOnly)
    {
        if (requested.Count == 0 || requested.Count > MaxTracks)
            throw new ArgumentException($"Select between 1 and {MaxTracks:N0} tracks per drag.");
        var ids = requested.Distinct().ToArray();
        var tracks = db.Tracks.AsNoTracking().Where(t => ids.Contains(t.Id))
            .Select(t => new { t.Id, t.FilePath }).ToDictionary(t => t.Id, t => t.FilePath);
        if (tracks.Count != ids.Length)
            throw new InvalidOperationException("Some selected tracks were removed from WISP. Refresh the selection and try again.");
        var missing = ids.Where(id => !File.Exists(tracks[id])).ToArray();
        if (missing.Length > 0 && !allowInternalOnly)
            throw new InvalidOperationException($"{missing.Length} selected file(s) are missing. Reconnect the drive, relink them, or deselect them before dragging. No files were sent.");
        // Preserve selection order and avoid offering the same file twice on Windows.
        // Missing audio must not break library organisation. Offer only IDs in
        // that case, never a silently incomplete file selection to another app.
        return new(requested.ToArray(), missing.Length > 0 ? [] :
            ids.Select(id => Path.GetFullPath(tracks[id])).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(), missing.Length);
    }
}
