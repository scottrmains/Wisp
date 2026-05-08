using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Wisp.Core.Discovery;
using Wisp.Infrastructure.Discovery;
using Wisp.Infrastructure.ExternalCatalog.YouTube;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Discovery;

public static class DiscoveryEndpoints
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() }
    };

    public static IEndpointRouteBuilder MapDiscovery(this IEndpointRouteBuilder app)
    {
        var sources = app.MapGroup("/api/discovery/sources");
        sources.MapGet("", ListSources);
        sources.MapPost("", CreateSource);
        sources.MapDelete("{id:guid}", DeleteSource);
        sources.MapPost("{id:guid}/scan", StartScan);
        sources.MapGet("{id:guid}/scan/events", StreamScan);
        sources.MapGet("{id:guid}/tracks", ListTracks);

        var tracks = app.MapGroup("/api/discovery/tracks");
        tracks.MapGet("{id:guid}", GetTrack);
        tracks.MapPost("{id:guid}/parse", UpdateParse);
        tracks.MapPost("{id:guid}/status", UpdateStatus);
        tracks.MapPost("{id:guid}/match", RunMatch);

        return app;
    }

    // ─── Sources ────────────────────────────────────────────────────────

    private static async Task<IResult> ListSources(WispDbContext db, CancellationToken ct)
    {
        var rows = await db.DiscoverySources.AsNoTracking()
            .OrderByDescending(s => s.AddedAt)
            .ToListAsync(ct);
        return Results.Ok(rows.Select(DiscoverySourceDto.From));
    }

    private static async Task<IResult> CreateSource(
        CreateSourceRequest body,
        WispDbContext db,
        YouTubeCatalogClient youTube,
        DiscoveryScanQueue queue,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Url))
            return Results.BadRequest(new { code = "url_required", message = "URL is required." });

        if (!youTube.IsConfigured)
            return Results.BadRequest(new { code = "youtube_unconfigured", message = "YouTube API key is not set." });

        var target = YouTubeUrlNormalizer.Parse(body.Url);
        if (target is null)
            return Results.BadRequest(new { code = "invalid_url", message = "Could not extract a YouTube channel or playlist id from that URL." });

        try
        {
            (DiscoverySourceType type, string externalId, string name, string? uploadsPlaylist) resolved = target.Kind switch
            {
                YouTubeUrlKind.Playlist => await ResolvePlaylist(youTube, target.Value, ct),
                YouTubeUrlKind.Channel => await ResolveChannel(youTube, await youTube.GetChannelByIdAsync(target.Value, ct)),
                YouTubeUrlKind.Handle => await ResolveChannel(youTube, await youTube.GetChannelByHandleAsync(target.Value, ct)),
                YouTubeUrlKind.Username => await ResolveChannel(youTube, await youTube.GetChannelByUsernameAsync(target.Value, ct)),
                YouTubeUrlKind.Custom => await ResolveChannel(youTube, await youTube.SearchChannelAsync(target.Value, ct)),
                _ => throw new InvalidOperationException($"Unsupported URL kind {target.Kind}"),
            };

            var existing = await db.DiscoverySources.FirstOrDefaultAsync(s => s.ExternalSourceId == resolved.externalId, ct);
            if (existing is not null)
                return Results.Conflict(new { code = "already_added", message = $"This {resolved.type} is already a source.", id = existing.Id });

            var src = new DiscoverySource
            {
                Id = Guid.NewGuid(),
                Name = resolved.name,
                SourceType = resolved.type,
                SourceUrl = body.Url.Trim(),
                ExternalSourceId = resolved.externalId,
                UploadsPlaylistId = resolved.uploadsPlaylist,
                AddedAt = DateTime.UtcNow,
            };
            db.DiscoverySources.Add(src);
            await db.SaveChangesAsync(ct);

            await queue.EnqueueAsync(new DiscoveryScanRequest(src.Id), ct);
            return Results.Created($"/api/discovery/sources/{src.Id}", DiscoverySourceDto.From(src));
        }
        catch (YouTubeNotConfiguredException)
        {
            return Results.BadRequest(new { code = "youtube_unconfigured", message = "YouTube API key is not set." });
        }
        catch (YouTubeQuotaExceededException ex)
        {
            return Results.BadRequest(new { code = "youtube_quota", message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return Results.BadRequest(new { code = "resolve_failed", message = ex.Message });
        }
    }

    private static async Task<(DiscoverySourceType, string, string, string?)> ResolveChannel(
        YouTubeCatalogClient _, YouTubeChannelInfo? info)
    {
        if (info is null) throw new InvalidOperationException("Channel not found.");
        return await Task.FromResult((DiscoverySourceType.YouTubeChannel, info.ChannelId, info.Title, info.UploadsPlaylistId));
    }

    private static async Task<(DiscoverySourceType, string, string, string?)> ResolvePlaylist(
        YouTubeCatalogClient youTube, string playlistId, CancellationToken ct)
    {
        var (info, _) = await youTube.GetPlaylistAsync(playlistId, ct, maxItems: 1);
        return (DiscoverySourceType.YouTubePlaylist, playlistId, info.Title, null);
    }

    private static async Task<IResult> DeleteSource(Guid id, WispDbContext db, CancellationToken ct)
    {
        var src = await db.DiscoverySources.FindAsync([id], ct);
        if (src is null) return Results.NotFound();
        db.DiscoverySources.Remove(src);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> StartScan(Guid id, WispDbContext db, DiscoveryScanQueue queue, CancellationToken ct)
    {
        var src = await db.DiscoverySources.FindAsync([id], ct);
        if (src is null) return Results.NotFound();
        await queue.EnqueueAsync(new DiscoveryScanRequest(id), ct);
        return Results.Accepted($"/api/discovery/sources/{id}");
    }

    private static async Task StreamScan(
        Guid id, HttpContext ctx, DiscoveryScanProgressBus bus, CancellationToken ct)
    {
        ctx.Response.Headers.ContentType = "text/event-stream";
        ctx.Response.Headers.CacheControl = "no-cache";
        ctx.Response.Headers.Connection = "keep-alive";
        ctx.Response.Headers["X-Accel-Buffering"] = "no";

        await foreach (var p in bus.SubscribeAsync(id, ct))
        {
            var payload = JsonSerializer.Serialize(p, Json);
            await ctx.Response.WriteAsync($"data: {payload}\n\n", ct);
            await ctx.Response.Body.FlushAsync(ct);
            if (p.Status is DiscoveryScanStatus.Completed or DiscoveryScanStatus.Failed or DiscoveryScanStatus.Cancelled)
                break;
        }
    }

    private static async Task<IResult> ListTracks(
        Guid id,
        WispDbContext db,
        string? status = null,
        string? search = null,
        int page = 1,
        int size = 200,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        size = Math.Clamp(size, 1, 1000);

        IQueryable<DiscoveredTrack> q = db.DiscoveredTracks.AsNoTracking()
            .Where(t => t.DiscoverySourceId == id);

        if (!string.IsNullOrWhiteSpace(status) && Enum.TryParse<DiscoveryStatus>(status, ignoreCase: true, out var s))
            q = q.Where(t => t.Status == s);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            q = q.Where(t =>
                EF.Functions.Like(t.RawTitle, pattern) ||
                (t.ParsedArtist != null && EF.Functions.Like(t.ParsedArtist, pattern)) ||
                (t.ParsedTitle != null && EF.Functions.Like(t.ParsedTitle, pattern)));
        }

        var total = await q.CountAsync(ct);
        var items = await q
            .OrderByDescending(t => t.ImportedAt)
            .Skip((page - 1) * size)
            .Take(size)
            .ToListAsync(ct);

        return Results.Ok(new
        {
            total,
            page,
            size,
            items = items.Select(DiscoveredTrackDto.From),
        });
    }

    // ─── Tracks ────────────────────────────────────────────────────────

    private static async Task<IResult> GetTrack(Guid id, WispDbContext db, CancellationToken ct)
    {
        var t = await db.DiscoveredTracks.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t is null) return Results.NotFound();
        var matches = await db.DigitalMatches.AsNoTracking()
            .Where(m => m.DiscoveredTrackId == id)
            .OrderByDescending(m => m.ConfidenceScore)
            .ToListAsync(ct);
        return Results.Ok(new
        {
            track = DiscoveredTrackDto.From(t),
            matches = matches.Select(DigitalMatchDto.From),
        });
    }

    private static async Task<IResult> UpdateParse(
        Guid id, UpdateParseRequest body, WispDbContext db, LocalLibraryMatcher matcher, CancellationToken ct)
    {
        var t = await db.DiscoveredTracks.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t is null) return Results.NotFound();

        t.ParsedArtist = string.IsNullOrWhiteSpace(body.Artist) ? null : body.Artist.Trim();
        t.ParsedTitle = string.IsNullOrWhiteSpace(body.Title) ? null : body.Title.Trim();
        t.MixVersion = string.IsNullOrWhiteSpace(body.Version) ? null : body.Version.Trim();
        t.ReleaseYear = body.Year;

        await db.SaveChangesAsync(ct);
        await matcher.ReconcileAsync(id, ct);
        return Results.Ok(DiscoveredTrackDto.From(t));
    }

    private static async Task<IResult> UpdateStatus(
        Guid id, UpdateStatusRequest body, WispDbContext db, CancellationToken ct)
    {
        var t = await db.DiscoveredTracks.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t is null) return Results.NotFound();
        var previous = t.Status;
        t.Status = body.Status;

        // When a Crate Digger track flips to Want, mirror it onto the
        // unified WantedTrack list so the user's wishlist is one place.
        // Idempotent on (Artist, Title) so re-flipping doesn't duplicate.
        if (body.Status == Wisp.Core.Discovery.DiscoveryStatus.Want
            && previous != Wisp.Core.Discovery.DiscoveryStatus.Want)
        {
            var artist = (t.ParsedArtist ?? "").Trim();
            var title = (t.ParsedTitle ?? t.RawTitle).Trim();
            if (!string.IsNullOrEmpty(artist) && !string.IsNullOrEmpty(title))
            {
                var alreadyExists = await db.WantedTracks
                    .AnyAsync(w => w.Artist == artist && w.Title == title, ct);
                if (!alreadyExists)
                {
                    db.WantedTracks.Add(new Wisp.Core.Wanted.WantedTrack
                    {
                        Id = Guid.NewGuid(),
                        Source = Wisp.Core.Wanted.WantedSource.CrateDigger,
                        Artist = artist,
                        Title = title,
                        SourceVideoId = t.SourceVideoId,
                        SourceUrl = t.SourceUrl,
                        ThumbnailUrl = t.ThumbnailUrl,
                        AddedAt = DateTime.UtcNow,
                    });
                }
            }
        }

        await db.SaveChangesAsync(ct);
        return Results.Ok(DiscoveredTrackDto.From(t));
    }

    private static async Task<IResult> RunMatch(
        Guid id, DigitalAvailabilityService svc, LocalLibraryMatcher matcher, CancellationToken ct)
    {
        try
        {
            await matcher.ReconcileAsync(id, ct);
            await svc.RunAsync(id, ct);
            return Results.Ok(new { ok = true });
        }
        catch (InvalidOperationException ex)
        {
            return Results.BadRequest(new { code = "match_failed", message = ex.Message });
        }
    }
}
