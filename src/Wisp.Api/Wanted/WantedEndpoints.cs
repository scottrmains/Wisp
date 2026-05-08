using Microsoft.EntityFrameworkCore;
using Wisp.Core.Wanted;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Wanted;

/// HTTP API for the user's cross-feature wishlist. Discover and Crate Digger
/// both write here when the user marks Want; the dedicated Wanted page reads
/// it; the library scan worker auto-flips MatchedLocalTrackId when a wanted
/// title appears locally.
public static class WantedEndpoints
{
    public static IEndpointRouteBuilder MapWanted(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/wanted-tracks", List);
        app.MapPost("/api/wanted-tracks", Create);
        app.MapDelete("/api/wanted-tracks/{id:guid}", Delete);
        return app;
    }

    private static async Task<IResult> List(WispDbContext db, CancellationToken ct)
    {
        // Newest first — the wishlist is timeline-ordered, source-badged in the UI.
        var rows = await db.WantedTracks.AsNoTracking()
            .OrderByDescending(w => w.AddedAt)
            .ToListAsync(ct);
        return Results.Ok(rows.Select(WantedTrackDto.From));
    }

    private static async Task<IResult> Create(
        CreateWantedTrackRequest body, WispDbContext db, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Artist) || string.IsNullOrWhiteSpace(body.Title))
        {
            return Results.BadRequest(new
            {
                code = "missing_fields",
                message = "Artist and Title are required.",
            });
        }

        var artist = body.Artist.Trim();
        var title = body.Title.Trim();

        // Idempotent on (Artist, Title) — case-insensitive collation in SQLite means
        // "Solomun" == "solomun" for the unique-index check, so we don't need to
        // normalize here. Just look up + return the existing row if present.
        var existing = await db.WantedTracks
            .FirstOrDefaultAsync(w => w.Artist == artist && w.Title == title, ct);
        if (existing is not null)
        {
            return Results.Ok(WantedTrackDto.From(existing));
        }

        var row = new WantedTrack
        {
            Id = Guid.NewGuid(),
            Source = body.Source,
            Artist = artist,
            Title = title,
            SourceVideoId = string.IsNullOrWhiteSpace(body.SourceVideoId) ? null : body.SourceVideoId.Trim(),
            SourceUrl = string.IsNullOrWhiteSpace(body.SourceUrl) ? null : body.SourceUrl.Trim(),
            ThumbnailUrl = string.IsNullOrWhiteSpace(body.ThumbnailUrl) ? null : body.ThumbnailUrl.Trim(),
            Notes = string.IsNullOrWhiteSpace(body.Notes) ? null : body.Notes.Trim(),
            AddedAt = DateTime.UtcNow,
        };
        db.WantedTracks.Add(row);
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/wanted-tracks/{row.Id}", WantedTrackDto.From(row));
    }

    private static async Task<IResult> Delete(Guid id, WispDbContext db, CancellationToken ct)
    {
        var row = await db.WantedTracks.FindAsync([id], ct);
        if (row is null) return Results.NotFound();
        db.WantedTracks.Remove(row);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }
}
