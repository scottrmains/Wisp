using Microsoft.EntityFrameworkCore;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Library;

/// Resolves existing library IDs, never accepts arbitrary file paths from web content.
public sealed class LibraryFileDrag(WispDbContext db)
{
    public const int MaxTracks = 20000;

    public string[] Resolve(IReadOnlyList<Guid> requested)
    {
        if (requested.Count == 0 || requested.Count > MaxTracks)
            throw new ArgumentException($"Select between 1 and {MaxTracks:N0} tracks per drag.");
        var ids = requested.Distinct().ToArray();
        var tracks = db.Tracks.AsNoTracking().Where(t => ids.Contains(t.Id))
            .Select(t => new { t.Id, t.FilePath }).ToDictionary(t => t.Id, t => t.FilePath);
        if (tracks.Count != ids.Length)
            throw new InvalidOperationException("Some selected tracks were removed from WISP. Refresh the selection and try again.");
        var missing = ids.Where(id => !File.Exists(tracks[id])).ToArray();
        if (missing.Length > 0)
            throw new InvalidOperationException($"{missing.Length} selected file(s) are missing. Reconnect the drive, relink them, or deselect them before dragging. No files were sent.");
        // Preserve selection order and avoid offering the same file twice on Windows.
        return ids.Select(id => Path.GetFullPath(tracks[id])).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }
}
