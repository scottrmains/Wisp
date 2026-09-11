using Microsoft.EntityFrameworkCore;
using Wisp.Core.Playlists;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Playlists;

public static class PlaylistMembership
{
    public const int MaxBatch = 20000;

    public static async Task<IResult> Add(Guid id, AddTracksToPlaylistRequest body, WispDbContext db, CancellationToken ct)
    {
        if (body.TrackIds is null || body.TrackIds.Count is < 1 or > MaxBatch)
            return Results.BadRequest(new { message = $"Select between 1 and {MaxBatch:N0} tracks." });
        if (body.DuplicateHandling is not ("ask" or "skip" or "add"))
            return Results.BadRequest(new { message = "Unknown duplicate handling option." });
        // SQLite's write transaction serializes the membership check and insert:
        // concurrent ordinary adds cannot both decide a track is absent.
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var playlist = await db.Playlists.FindAsync([id], ct);
        if (playlist is null) return Results.NotFound(new { message = "This playlist no longer exists." });
        // Repeated IDs in a request aren't themselves permission to add twice.
        var ids = body.TrackIds.Distinct().ToArray();
        var valid = await db.Tracks.Where(t => ids.Contains(t.Id)).Select(t => t.Id).ToListAsync(ct);
        if (valid.Count != ids.Length)
            return Results.BadRequest(new { code = "track_not_found", message = "Some selected tracks no longer exist in WISP. Refresh the selection. Nothing was added." });
        var existing = await db.PlaylistTracks.Where(t => t.PlaylistId == id && ids.Contains(t.TrackId))
            .Select(t => t.TrackId).Distinct().ToListAsync(ct);
        if (existing.Count > 0 && body.DuplicateHandling == "ask")
            return Results.Conflict(new { code = "playlist_duplicates", duplicateCount = existing.Count,
                message = $"{existing.Count} selected {(existing.Count == 1 ? "track is" : "tracks are")} already in \"{playlist.Name}\". Nothing has been added yet." });
        var existingSet = existing.ToHashSet();
        var toAdd = ids.Where(trackId => body.DuplicateHandling == "add" || !existingSet.Contains(trackId)).ToArray();
        var now = DateTime.UtcNow;
        db.PlaylistTracks.AddRange(toAdd.Select(trackId => new PlaylistTrack
        {
            Id = Guid.NewGuid(), PlaylistId = id, TrackId = trackId, AddedAt = now,
        }));
        if (toAdd.Length > 0) playlist.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Results.Ok(new { added = toAdd.Length, skipped = ids.Length - toAdd.Length });
    }

    public static async Task<IResult> RemoveEntries(Guid id, RemovePlaylistEntriesRequest body, WispDbContext db, CancellationToken ct)
    {
        if (body.EntryIds is null || body.EntryIds.Count is < 1 or > MaxBatch)
            return Results.BadRequest(new { message = $"Select between 1 and {MaxBatch:N0} playlist entries." });
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var playlist = await db.Playlists.FindAsync([id], ct);
        if (playlist is null) return Results.NotFound(new { message = "This playlist no longer exists." });
        // Scope by BOTH playlist and entry ID. Other copies, other playlists,
        // library tracks, mix plans, cues and source audio are never deleted.
        var entries = await db.PlaylistTracks.Where(t => t.PlaylistId == id && body.EntryIds.Contains(t.Id)).ToListAsync(ct);
        db.PlaylistTracks.RemoveRange(entries);
        if (entries.Count > 0) playlist.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Results.Ok(new { removed = entries.Count });
    }
}
