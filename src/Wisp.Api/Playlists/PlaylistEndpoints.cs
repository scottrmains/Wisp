using Microsoft.EntityFrameworkCore;
using Wisp.Api.MixPlans;
using Wisp.Core.Playlists;
using Wisp.Infrastructure.Persistence;
using Wisp.Infrastructure.Usb;

namespace Wisp.Api.Playlists;

public static class PlaylistEndpoints
{
    // Removable-drive exports use a read-only, player-accepted Pioneer PDB as
    // their allocation template instead of the rejected hand-built initializer.
    private static readonly bool DirectCdjExportEnabled = true;
    private static readonly HashSet<string> CdjSupportedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp3", ".m4a", ".aac", ".wav", ".aiff", ".aif",
    };

    public static IEndpointRouteBuilder MapPlaylists(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/playlists");
        g.MapGet("", List);
        g.MapPost("", Create);
        g.MapGet("{id:guid}", Get);
        g.MapPatch("{id:guid}", Update);
        g.MapDelete("{id:guid}", Delete);
        g.MapPost("{id:guid}/cdj-export/preflight", CdjExportPreflight);
        g.MapPost("{id:guid}/export-to-cdj", ExportToCdj);
        g.MapPost("{id:guid}/tracks", AddTrack);
        g.MapPost("{id:guid}/tracks/bulk", AddTracksBulk);
        g.MapPost("{id:guid}/entries/remove", PlaylistMembership.RemoveEntries);
        g.MapGet("{id:guid}/duplicates", PlaylistDuplicates.Scan);
        g.MapPost("{id:guid}/duplicates/remove", PlaylistDuplicates.Remove);
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
            .Include(x => x.Tracks.OrderByDescending(t => t.AddedAt).ThenBy(t => t.Id))
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

    private static async Task<IResult> CdjExportPreflight(
        Guid id, CdjExportPreflightRequest body, WispDbContext db, PioneerUsbExportService deviceExport, CancellationToken ct)
    {
        if (!DirectCdjExportEnabled) return DirectCdjExportUnavailable();
        if (string.IsNullOrWhiteSpace(body.TargetFolder))
            return Results.BadRequest(new { code = "target_required", message = "Select the root folder of the USB drive." });
        if (!Directory.Exists(body.TargetFolder))
            return Results.BadRequest(new { code = "target_missing", message = $"USB target does not exist: {body.TargetFolder}" });
        try { await deviceExport.ValidateUsbTargetAsync(body.TargetFolder, body.UsbDeviceId, ct); }
        catch (UsbExportTargetException ex) { return Results.BadRequest(new { code = "usb_target_incompatible", message = ex.Message }); }

        var playlist = await LoadPlaylist(db, id, ct);
        if (playlist is null) return Results.NotFound();
        var tracks = playlist.Tracks.Select(t => t.Track).Where(t => t is not null).Cast<Wisp.Core.Tracks.Track>().DistinctBy(t => t.Id).ToList();
        var root = Path.GetFullPath(body.TargetFolder);
        var unsupported = tracks.Where(t => !CdjSupportedExtensions.Contains(Path.GetExtension(t.FileName))).Select(t => t.FileName).ToList();
        var missing = tracks.Where(t => t.IsUnavailable || !File.Exists(t.FilePath)).Select(t => t.FileName).ToList();
        var selectedIds = tracks.Select(t => t.Id).ToList();
        var cueCount = await db.DeviceCues.AsNoTracking().CountAsync(c => selectedIds.Contains(c.TrackId), ct);
        var requiredBytes = tracks.Where(t => File.Exists(t.FilePath)).Sum(t => new FileInfo(t.FilePath).Length);
        var drive = new DriveInfo(Path.GetPathRoot(root)!);
        return Results.Ok(new CdjExportPreflightDto(
            tracks.Count, cueCount, requiredBytes, drive.AvailableFreeSpace,
            Directory.Exists(Path.Combine(root, "PIONEER")), missing, unsupported));
    }

    private static async Task<IResult> ExportToCdj(
        Guid id,
        ExportToCdjRequest body,
        WispDbContext db,
        PioneerUsbExportService deviceExport,
        CancellationToken ct)
    {
        if (!DirectCdjExportEnabled) return DirectCdjExportUnavailable();
        if (string.IsNullOrWhiteSpace(body.UsbDeviceId))
            return Results.BadRequest(new { code = "usb_selection_required", message = "Select a connected USB from the export device list." });
        if (string.IsNullOrWhiteSpace(body.TargetFolder))
            return Results.BadRequest(new { code = "target_required", message = "Select the root folder of the USB drive." });
        var playlist = await LoadPlaylist(db, id, ct);
        if (playlist is null) return Results.NotFound();
        var selectedTracks = playlist.Tracks.Select(t => t.Track).Where(t => t is not null).Cast<Wisp.Core.Tracks.Track>().DistinctBy(t => t.Id).ToList();
        if (selectedTracks.Count == 0)
            return Results.BadRequest(new { code = "playlist_empty", message = "Add tracks to the playlist before exporting." });

        var selectedIds = selectedTracks.Select(t => t.Id).ToHashSet();
        var libraryPlaylists = await db.Playlists.AsNoTracking()
            .Include(p => p.Tracks).ThenInclude(pt => pt.Track)
            .Where(p => p.Id != id)
            .ToListAsync(ct);
        var exportPlaylists = new List<UsbPlaylist> { new(playlist.Name, selectedTracks) };
        exportPlaylists.AddRange(libraryPlaylists.Select(p => new UsbPlaylist(
            p.Name,
            p.Tracks.Select(pt => pt.Track).Where(t => t is not null && selectedIds.Contains(t.Id)).Cast<Wisp.Core.Tracks.Track>().ToList()))
            .Where(p => p.Tracks.Count > 0));
        var deviceCues = await db.DeviceCues.AsNoTracking()
            .Where(c => selectedIds.Contains(c.TrackId))
            .OrderBy(c => c.StartSeconds)
            .ToListAsync(ct);

        try
        {
            return Results.Ok(await deviceExport.ExportAsync(
                body.TargetFolder, playlist.Name, selectedTracks, exportPlaylists, deviceCues,
                body.ConfirmReplaceExistingPioneerLibrary, ct, body.UsbDeviceId));
        }
        catch (UsbExportTargetException ex)
        {
            return Results.BadRequest(new { code = "usb_target_incompatible", message = ex.Message });
        }
        catch (PioneerLibraryExistsException ex)
        {
            return Results.Conflict(new { code = "pioneer_library_exists", message = ex.Message, requiresConfirmation = true });
        }
        catch (UnsupportedPioneerFormatException ex)
        {
            return Results.BadRequest(new { code = "unsupported_format", message = ex.Message });
        }
        catch (PioneerWaveformException ex)
        {
            return Results.BadRequest(new { code = "cdj_waveform_failed", message = ex.Message });
        }
        catch (PioneerTemplateRequiredException ex)
        {
            return Results.BadRequest(new { code = "pioneer_template_required", message = ex.Message });
        }
        catch (DirectoryNotFoundException ex)
        {
            return Results.BadRequest(new { code = "target_missing", message = ex.Message });
        }
        catch (UnauthorizedAccessException ex)
        {
            return Results.Problem(title: "CDJ USB export failed", detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
        catch (IOException ex)
        {
            return Results.Problem(title: "CDJ USB export failed", detail: ex.Message, statusCode: StatusCodes.Status409Conflict);
        }
    }

    private static IResult DirectCdjExportUnavailable() => Results.Problem(
        title: "Direct CDJ export is unavailable",
        detail: "Direct CDJ export is currently unavailable.",
        statusCode: StatusCodes.Status501NotImplemented);

    private static async Task<Playlist?> LoadPlaylist(WispDbContext db, Guid id, CancellationToken ct)
        => await db.Playlists
            .AsNoTracking()
            .Include(p => p.Tracks.OrderByDescending(t => t.AddedAt))
            .ThenInclude(t => t.Track)
            .FirstOrDefaultAsync(p => p.Id == id, ct);

    // Single and bulk additions share the same atomic duplicate policy.
    private static Task<IResult> AddTrack(Guid id, AddTrackToPlaylistRequest body, WispDbContext db, CancellationToken ct)
        => PlaylistMembership.Add(id, new([body.TrackId], body.DuplicateHandling), db, ct);

    private static Task<IResult> AddTracksBulk(Guid id, AddTracksToPlaylistRequest body, WispDbContext db, CancellationToken ct)
        => PlaylistMembership.Add(id, body, db, ct);

    private static async Task<IResult> RemoveTrack(Guid playlistId, Guid trackId, WispDbContext db, CancellationToken ct)
    {
        // Legacy track-ID API removes all occurrences of that track. The UI uses
        // entry-ID removal instead, so one selected repeat can be removed alone.
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var entries = await db.PlaylistTracks
            .Where(t => t.PlaylistId == playlistId && t.TrackId == trackId).ToListAsync(ct);
        if (entries.Count == 0) return Results.NoContent();

        db.PlaylistTracks.RemoveRange(entries);
        var playlist = await db.Playlists.FindAsync([playlistId], ct);
        if (playlist is not null) playlist.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Results.NoContent();
    }
}
