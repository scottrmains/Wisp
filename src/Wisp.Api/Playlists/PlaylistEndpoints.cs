using Microsoft.EntityFrameworkCore;
using Wisp.Core.Playlists;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Playlists;

public static class PlaylistEndpoints
{
    public static IEndpointRouteBuilder MapPlaylists(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/playlists");
        g.MapGet("", List);
        g.MapPost("", Create);
        g.MapGet("{id:guid}", Get);
        g.MapPatch("{id:guid}", Update);
        g.MapDelete("{id:guid}", Delete);
        g.MapPost("{id:guid}/tracks", AddTrack);
        g.MapPost("{id:guid}/tracks/bulk", AddTracksBulk);
        g.MapDelete("{playlistId:guid}/tracks/{trackId:guid}", RemoveTrack);
        return app;
    }

    private static async Task<IResult> List(WispDbContext db, CancellationToken ct)
    {
        // EF can't translate constructor projection followed by OrderBy on the projection,
        // so we order BEFORE projecting (same trick used for MixPlans).
        var playlists = await db.Playlists
            .AsNoTracking()
            .OrderByDescending(p => p.UpdatedAt)
            .Select(p => new PlaylistSummaryDto(
                p.Id, p.Name, p.Notes, p.Tracks.Count, p.CreatedAt, p.UpdatedAt))
            .ToListAsync(ct);
        return Results.Ok(playlists);
    }

    private static async Task<IResult> Create(CreatePlaylistRequest body, WispDbContext db, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Name))
            return Results.BadRequest(new { code = "name_required", message = "Name is required." });

        var now = DateTime.UtcNow;
        var p = new Playlist
        {
            Id = Guid.NewGuid(),
            Name = body.Name.Trim(),
            Notes = body.Notes,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Playlists.Add(p);
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/playlists/{p.Id}", new PlaylistSummaryDto(
            p.Id, p.Name, p.Notes, 0, p.CreatedAt, p.UpdatedAt));
    }

    private static async Task<IResult> Get(Guid id, WispDbContext db, CancellationToken ct)
    {
        var p = await db.Playlists
            .AsNoTracking()
            // Newest add first — matches the AddedAt index intent.
            .Include(x => x.Tracks.OrderByDescending(t => t.AddedAt))
                .ThenInclude(t => t.Track)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        return p is null
            ? Results.NotFound()
            : Results.Ok(new PlaylistDto(
                p.Id, p.Name, p.Notes, p.CreatedAt, p.UpdatedAt,
                p.Tracks.Select(PlaylistTrackDto.From).ToList()));
    }

    private static async Task<IResult> Update(Guid id, UpdatePlaylistRequest body, WispDbContext db, CancellationToken ct)
    {
        var p = await db.Playlists.FindAsync([id], ct);
        if (p is null) return Results.NotFound();

        if (body.Name is not null)
        {
            if (string.IsNullOrWhiteSpace(body.Name))
                return Results.BadRequest(new { code = "name_required", message = "Name cannot be blank." });
            p.Name = body.Name.Trim();
        }
        if (body.Notes is not null) p.Notes = body.Notes;

        p.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var trackCount = await db.PlaylistTracks.CountAsync(t => t.PlaylistId == id, ct);
        return Results.Ok(new PlaylistSummaryDto(p.Id, p.Name, p.Notes, trackCount, p.CreatedAt, p.UpdatedAt));
    }

    private static async Task<IResult> Delete(Guid id, WispDbContext db, CancellationToken ct)
    {
        var p = await db.Playlists.FindAsync([id], ct);
        if (p is null) return Results.NotFound();
        db.Playlists.Remove(p);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    /// Idempotent — adding the same track twice returns the existing row instead
    /// of erroring on the unique index. Matches the same convention as TrackTag adds.
    private static async Task<IResult> AddTrack(Guid id, AddTrackToPlaylistRequest body, WispDbContext db, CancellationToken ct)
    {
        var playlist = await db.Playlists.FindAsync([id], ct);
        if (playlist is null) return Results.NotFound();
        var trackExists = await db.Tracks.AnyAsync(t => t.Id == body.TrackId, ct);
        if (!trackExists)
            return Results.BadRequest(new { code = "track_not_found", message = "Track does not exist." });

        var existing = await db.PlaylistTracks
            .Include(t => t.Track)
            .FirstOrDefaultAsync(t => t.PlaylistId == id && t.TrackId == body.TrackId, ct);
        if (existing is not null) return Results.Ok(PlaylistTrackDto.From(existing));

        var pt = new PlaylistTrack
        {
            Id = Guid.NewGuid(),
            PlaylistId = id,
            TrackId = body.TrackId,
            AddedAt = DateTime.UtcNow,
        };
        db.PlaylistTracks.Add(pt);
        playlist.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var loaded = await db.PlaylistTracks.AsNoTracking()
            .Include(t => t.Track)
            .FirstAsync(t => t.Id == pt.Id, ct);
        return Results.Created($"/api/playlists/{id}/tracks/{pt.TrackId}", PlaylistTrackDto.From(loaded));
    }

    /// Bulk-add — fed by Phase 17's bulk action bar. Skips any tracks already in
    /// the playlist (idempotent). Returns the count actually inserted.
    private static async Task<IResult> AddTracksBulk(Guid id, AddTracksToPlaylistRequest body, WispDbContext db, CancellationToken ct)
    {
        var playlist = await db.Playlists.FindAsync([id], ct);
        if (playlist is null) return Results.NotFound();
        if (body.TrackIds.Count == 0) return Results.Ok(new { added = 0, skipped = 0 });

        // Validate the requested track ids exist; any unknown ids are silently skipped
        // rather than failing the whole batch.
        var validIds = await db.Tracks
            .Where(t => body.TrackIds.Contains(t.Id))
            .Select(t => t.Id)
            .ToListAsync(ct);
        var validSet = validIds.ToHashSet();

        var alreadyIn = await db.PlaylistTracks
            .Where(t => t.PlaylistId == id && validSet.Contains(t.TrackId))
            .Select(t => t.TrackId)
            .ToListAsync(ct);
        var alreadySet = alreadyIn.ToHashSet();

        var now = DateTime.UtcNow;
        var added = 0;
        foreach (var trackId in body.TrackIds)
        {
            if (!validSet.Contains(trackId)) continue;
            if (alreadySet.Contains(trackId)) continue;
            db.PlaylistTracks.Add(new PlaylistTrack
            {
                Id = Guid.NewGuid(),
                PlaylistId = id,
                TrackId = trackId,
                AddedAt = now,
            });
            added++;
        }
        playlist.UpdatedAt = now;
        await db.SaveChangesAsync(ct);

        return Results.Ok(new { added, skipped = body.TrackIds.Count - added });
    }

    private static async Task<IResult> RemoveTrack(Guid playlistId, Guid trackId, WispDbContext db, CancellationToken ct)
    {
        var pt = await db.PlaylistTracks
            .FirstOrDefaultAsync(t => t.PlaylistId == playlistId && t.TrackId == trackId, ct);
        if (pt is null) return Results.NoContent();

        db.PlaylistTracks.Remove(pt);
        var playlist = await db.Playlists.FindAsync([playlistId], ct);
        if (playlist is not null) playlist.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }
}
