using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Playlists;

public sealed record PlaylistDuplicateGroup(Guid TrackId, string? Title, string? Artist, string FileName, int Occurrences);
public sealed record PlaylistDuplicateScan(string Snapshot, int TotalEntries, int DuplicateEntries, IReadOnlyList<PlaylistDuplicateGroup> Groups);
public sealed record RemovePlaylistDuplicatesRequest(string? Snapshot);

public static class PlaylistDuplicates
{
    // Membership only: no title/fuzzy matching, file deletion or library merging.
    private sealed record Entry(Guid Id, Guid TrackId, DateTime AddedAt, string? Title, string? Artist, string FileName);

    private static Task<List<Entry>> ReadEntries(Guid id, WispDbContext db, CancellationToken ct) =>
        db.PlaylistTracks.AsNoTracking().Where(e => e.PlaylistId == id)
            .Select(e => new Entry(e.Id, e.TrackId, e.AddedAt, e.Track!.Title, e.Track.Artist, e.Track.FileName))
            .ToListAsync(ct);

    private static string Snapshot(Guid id, List<Entry> entries) => Convert.ToHexString(SHA256.HashData(
        Encoding.UTF8.GetBytes(id.ToString("N") + string.Concat(entries.OrderBy(e => e.Id)
            .Select(e => $"|{e.Id:N}:{e.TrackId:N}:{e.AddedAt.Ticks}")))));

    private static IEnumerable<IGrouping<Guid, Entry>> Groups(List<Entry> entries) =>
        entries.OrderBy(e => e.AddedAt).ThenBy(e => e.Id).GroupBy(e => e.TrackId).Where(g => g.Count() > 1);

    public static async Task<IResult> Scan(Guid id, WispDbContext db, CancellationToken ct)
    {
        if (!await db.Playlists.AnyAsync(p => p.Id == id, ct))
            return Results.NotFound(new { message = "This playlist no longer exists." });
        // Scan the whole membership, independent of library filters/pagination.
        var entries = await ReadEntries(id, db, ct);
        var groups = Groups(entries).Select(g => new PlaylistDuplicateGroup(
            g.Key, g.First().Title, g.First().Artist, g.First().FileName, g.Count())).ToList();
        return Results.Ok(new PlaylistDuplicateScan(Snapshot(id, entries), entries.Count,
            groups.Sum(g => g.Occurrences - 1), groups));
    }

    public static async Task<IResult> Remove(Guid id, RemovePlaylistDuplicatesRequest body, WispDbContext db, CancellationToken ct)
    {
        if (body.Snapshot is null || body.Snapshot.Length != 64)
            return Results.BadRequest(new { message = "Scan this playlist before removing duplicates." });
        // Serialize validation and deletion with other membership writes. Never
        // delete entries the user has not seen if membership changed after scan.
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var playlist = await db.Playlists.FindAsync([id], ct);
        if (playlist is null) return Results.NotFound(new { message = "This playlist no longer exists." });
        var entries = await ReadEntries(id, db, ct);
        if (!string.Equals(body.Snapshot, Snapshot(id, entries), StringComparison.Ordinal))
            return Results.Conflict(new { code = "playlist_scan_stale",
                message = "This playlist changed since the scan. Nothing was removed. Scan again to review the current duplicates." });

        // Keep the oldest-added occurrence (entry ID breaks timestamp ties).
        var ids = Groups(entries).SelectMany(g => g.Skip(1)).Select(e => e.Id).ToArray();
        var removed = await db.PlaylistTracks.Where(e => e.PlaylistId == id && ids.Contains(e.Id)).ExecuteDeleteAsync(ct);
        if (removed > 0) playlist.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Results.Ok(new { removed });
    }
}
