using Microsoft.EntityFrameworkCore;
using Wisp.Infrastructure.ArtistRefresh;
using Wisp.Infrastructure.ExternalCatalog.Discogs;
using Wisp.Infrastructure.ExternalCatalog.Spotify;
using Wisp.Infrastructure.ExternalCatalog.YouTube;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.ArtistRefresh;

public static class ArtistRefreshEndpoints
{
    public static IEndpointRouteBuilder MapArtistRefresh(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/artists");
        g.MapGet("", List);
        g.MapGet("{id:guid}/match-candidates", MatchCandidates);
        g.MapPost("{id:guid}/match", AssignMatch);
        g.MapPost("{id:guid}/refresh", Refresh);
        g.MapGet("{id:guid}/releases", ListReleases);

        app.MapPatch("/api/releases/{id:guid}", UpdateRelease);

        app.MapPost("/api/spotify/test", TestSpotify);
        app.MapPost("/api/discogs/test", TestDiscogs);
        app.MapPost("/api/youtube/test", TestYouTube);
        return app;
    }

    private static async Task<IResult> List(ArtistRefreshService svc, CancellationToken ct)
    {
        var summaries = await svc.ListAsync(ct);
        return Results.Ok(summaries.Select(ArtistSummaryDto.From));
    }

    private static async Task<IResult> MatchCandidates(
        Guid id,
        ArtistRefreshService svc,
        string? source = "Spotify",
        CancellationToken ct = default)
    {
        var normalizedSource = NormalizeSource(source);
        if (normalizedSource is null)
            return Results.BadRequest(new { code = "unsupported_source", message = $"Unsupported source '{source}'." });

        try
        {
            var candidates = await svc.GetMatchCandidatesAsync(id, normalizedSource, ct);
            return Results.Ok(candidates.Select(CandidateDto.From));
        }
        catch (SpotifyNotConfiguredException)
        {
            return Results.BadRequest(new { code = "spotify_unconfigured", message = "Spotify credentials are not set." });
        }
        catch (DiscogsNotConfiguredException)
        {
            return Results.BadRequest(new { code = "discogs_unconfigured", message = "Discogs token is not set." });
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
            return Results.NotFound(new { code = "not_found", message = ex.Message });
        }
    }

    private static async Task<IResult> AssignMatch(
        Guid id, AssignMatchRequest body, ArtistRefreshService svc, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.ExternalId))
            return Results.BadRequest(new { code = "external_id_required", message = "ExternalId is required." });

        var normalizedSource = NormalizeSource(body.Source);
        if (normalizedSource is null)
            return Results.BadRequest(new { code = "unsupported_source", message = $"Unsupported source '{body.Source}'." });

        var artist = await svc.AssignMatchAsync(id, normalizedSource, body.ExternalId, ct);
        return Results.Ok(new
        {
            id = artist.Id,
            spotifyArtistId = artist.SpotifyArtistId,
            discogsArtistId = artist.DiscogsArtistId,
            youTubeChannelId = artist.YouTubeChannelId,
        });
    }

    private static string? NormalizeSource(string? raw) => raw?.ToLowerInvariant() switch
    {
        "spotify" => CatalogSources.Spotify,
        "discogs" => CatalogSources.Discogs,
        "youtube" => CatalogSources.YouTube,
        _ => null,
    };

    private static async Task<IResult> Refresh(Guid id, ArtistRefreshService svc, CancellationToken ct)
    {
        try
        {
            var inserted = await svc.RefreshAsync(id, ct);
            return Results.Ok(new { inserted });
        }
        catch (SpotifyNotConfiguredException)
        {
            return Results.BadRequest(new { code = "spotify_unconfigured", message = "Spotify credentials are not set." });
        }
        catch (DiscogsNotConfiguredException)
        {
            return Results.BadRequest(new { code = "discogs_unconfigured", message = "Discogs token is not set." });
        }
        catch (YouTubeQuotaExceededException ex)
        {
            return Results.BadRequest(new { code = "youtube_quota", message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return Results.BadRequest(new { code = "refresh_invalid", message = ex.Message });
        }
    }

    private static async Task<IResult> ListReleases(
        Guid id, WispDbContext db, string? status = null, CancellationToken ct = default)
    {
        IQueryable<Wisp.Core.ArtistRefresh.ExternalRelease> q = db.ExternalReleases.AsNoTracking()
            .Where(r => r.ArtistProfileId == id);

        q = (status?.ToLowerInvariant()) switch
        {
            "dismissed" => q.Where(r => r.IsDismissed),
            "saved" => q.Where(r => r.IsSavedForLater),
            "library" => q.Where(r => r.IsAlreadyInLibrary),
            "new" => q.Where(r => !r.IsDismissed && !r.IsSavedForLater && !r.IsAlreadyInLibrary),
            _ => q,
        };

        var rows = await q.OrderByDescending(r => r.ReleaseDate).ToListAsync(ct);
        return Results.Ok(rows.Select(ReleaseDto.From));
    }

    private static async Task<IResult> UpdateRelease(
        Guid id, UpdateReleaseRequest body, WispDbContext db, CancellationToken ct)
    {
        var release = await db.ExternalReleases.FindAsync([id], ct);
        if (release is null) return Results.NotFound();

        if (body.IsDismissed.HasValue) release.IsDismissed = body.IsDismissed.Value;
        if (body.IsSavedForLater.HasValue) release.IsSavedForLater = body.IsSavedForLater.Value;

        await db.SaveChangesAsync(ct);
        return Results.Ok(ReleaseDto.From(release));
    }

    private static async Task<IResult> TestSpotify(SpotifyCatalogClient client, CancellationToken ct)
        => await TestRunner(client.TestConnectionAsync, ct);

    private static async Task<IResult> TestDiscogs(DiscogsCatalogClient client, CancellationToken ct)
        => await TestRunner(client.TestConnectionAsync, ct);

    private static async Task<IResult> TestYouTube(YouTubeCatalogClient client, CancellationToken ct)
        => await TestRunner(client.TestConnectionAsync, ct);

    private static async Task<IResult> TestRunner(Func<CancellationToken, Task<string?>> probe, CancellationToken ct)
    {
        var error = await probe(ct);
        return error is null
            ? Results.Ok(new { ok = true })
            : Results.BadRequest(new { ok = false, message = error });
    }
}
