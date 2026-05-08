using Microsoft.EntityFrameworkCore;
using Wisp.Core.Tagging;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Tagging;

public static class TagEndpoints
{
    public static IEndpointRouteBuilder MapTags(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/tracks/{id:guid}/tags", ListForTrack);
        app.MapPost("/api/tracks/{id:guid}/tags", AddToTrack);
        app.MapDelete("/api/tracks/{trackId:guid}/tags/{tagId:guid}", RemoveFromTrack);
        // Library-wide distinct tag list — drives autocomplete + filter pills.
        app.MapGet("/api/tags", ListAll);
        return app;
    }

    private static async Task<IResult> ListForTrack(Guid id, WispDbContext db, CancellationToken ct)
    {
        var tags = await db.TrackTags
            .AsNoTracking()
            .Where(t => t.TrackId == id)
            .OrderBy(t => t.Type).ThenBy(t => t.Name)
            .Select(t => new TagDto(t.Id, t.Name, t.Type.ToString()))
            .ToListAsync(ct);
        return Results.Ok(tags);
    }

    private record AddTagRequest(string Name, string Type);

    private static async Task<IResult> AddToTrack(Guid id, AddTagRequest body, WispDbContext db, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Name))
            return Results.BadRequest(new { code = "name_required", message = "Tag name cannot be empty." });
        if (!Enum.TryParse<TrackTagType>(body.Type, ignoreCase: true, out var type))
            return Results.BadRequest(new { code = "invalid_type", message = $"Unknown tag type '{body.Type}'." });

        var trimmed = body.Name.Trim();
        if (trimmed.Length > 60)
            return Results.BadRequest(new { code = "name_too_long", message = "Tag names are capped at 60 chars." });

        var trackExists = await db.Tracks.AnyAsync(t => t.Id == id, ct);
        if (!trackExists) return Results.NotFound();

        // Idempotent: if the same tag is already on this track, return the existing row instead of erroring on the unique index.
        var existing = await db.TrackTags
            .FirstOrDefaultAsync(t => t.TrackId == id && t.Name == trimmed, ct);
        if (existing is not null)
            return Results.Ok(new TagDto(existing.Id, existing.Name, existing.Type.ToString()));

        var tag = new TrackTag
        {
            Id = Guid.NewGuid(),
            TrackId = id,
            Name = trimmed,
            Type = type,
            CreatedAt = DateTime.UtcNow,
        };
        db.TrackTags.Add(tag);
        await db.SaveChangesAsync(ct);
        return Results.Ok(new TagDto(tag.Id, tag.Name, tag.Type.ToString()));
    }

    private static async Task<IResult> RemoveFromTrack(Guid trackId, Guid tagId, WispDbContext db, CancellationToken ct)
    {
        var tag = await db.TrackTags.FirstOrDefaultAsync(t => t.Id == tagId && t.TrackId == trackId, ct);
        if (tag is null) return Results.NoContent();
        db.TrackTags.Remove(tag);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    /// Distinct (Name, Type) pairs across the library, with a count of how many tracks
    /// carry each. Used by the filter-pill UI and the inspector autocomplete.
    /// Materialised first because the SQLite provider can't translate enum.ToString()
    /// inside a projection — group + count in SQL, format the type label client-side.
    private static async Task<IResult> ListAll(WispDbContext db, CancellationToken ct)
    {
        var rows = await db.TrackTags
            .AsNoTracking()
            .GroupBy(t => new { t.Name, t.Type })
            .Select(g => new { g.Key.Name, g.Key.Type, Count = g.Count() })
            .ToListAsync(ct);

        var result = rows
            .Select(r => new TagSummaryDto(r.Name, r.Type.ToString(), r.Count))
            .OrderByDescending(r => r.UseCount)
            .ThenBy(r => r.Name)
            .ToList();

        return Results.Ok(result);
    }
}

public sealed record TagDto(Guid Id, string Name, string Type);
public sealed record TagSummaryDto(string Name, string Type, int UseCount);
