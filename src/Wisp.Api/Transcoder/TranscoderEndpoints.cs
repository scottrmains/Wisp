using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Transcoder;

/// HTTP API for Phase 23 — exposes FFmpeg detection status and the
/// per-track FLAC → MP3 320 convert action.
public static class TranscoderEndpoints
{
    public static IEndpointRouteBuilder MapTranscoder(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/transcoder/status", GetStatus);
        app.MapPost("/api/tracks/{id:guid}/convert-to-mp3", ConvertToMp3);
        return app;
    }

    private static IResult GetStatus(Mp3Transcoder transcoder)
        => Results.Ok(new TranscoderStatusDto(
            IsReady: transcoder.IsAvailable,
            FfmpegPath: transcoder.FfmpegPath,
            Bundled: transcoder.IsBundled));

    private static async Task<IResult> ConvertToMp3(
        Guid id,
        ConvertToMp3Request? body,
        WispDbContext db,
        Mp3Transcoder transcoder,
        ILogger<Mp3Transcoder> log,
        CancellationToken ct)
    {
        var track = await db.Tracks.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id, ct);
        if (track is null) return Results.NotFound();

        if (!File.Exists(track.FilePath))
        {
            return Results.Problem(
                title: "Source file not found",
                detail: track.FilePath,
                statusCode: StatusCodes.Status410Gone);
        }

        if (!transcoder.IsAvailable)
        {
            return Results.BadRequest(new
            {
                code = "ffmpeg_not_available",
                message = "FFmpeg isn't bundled or configured. Run tools/get-ffmpeg.ps1 or set the path in Settings.",
            });
        }

        // Default output dir = source file's folder. Lets the user keep the
        // converted file alongside the original, which is what they almost
        // always want for a single-track convert (DJs typically grab from
        // one spot then drag onto a USB).
        var outputDir = string.IsNullOrWhiteSpace(body?.OutputFolder)
            ? Path.GetDirectoryName(track.FilePath) ?? AppContext.BaseDirectory
            : body!.OutputFolder!;

        if (!Directory.Exists(outputDir))
        {
            return Results.BadRequest(new
            {
                code = "output_folder_missing",
                message = $"Output folder doesn't exist: {outputDir}",
            });
        }

        var bitrate = body?.Bitrate ?? 320;

        // Filename = "Artist - Title". Falls back to the source filename
        // (without extension) when the tag fields are blank — common for
        // poorly tagged crate finds.
        var artist = (track.Artist ?? "").Trim();
        var title = (track.Title ?? "").Trim();
        var baseName = (artist, title) switch
        {
            ("", "") => Path.GetFileNameWithoutExtension(track.FilePath),
            ("", _) => title,
            (_, "") => artist,
            _ => $"{artist} - {title}",
        };

        try
        {
            var result = await transcoder.ConvertAsync(
                inputPath: track.FilePath,
                outputDir: outputDir,
                desiredBaseName: baseName,
                bitrateKbps: bitrate,
                progress: null, // Phase 23d will hook a progress bus / SSE
                ct: ct);

            return Results.Ok(new ConvertToMp3Response(
                OutputPath: result.OutputPath,
                SizeBytes: result.SizeBytes,
                DurationSeconds: result.Duration.TotalSeconds));
        }
        catch (TranscodeException ex)
        {
            log.LogWarning(ex, "MP3 convert failed for {Path}", track.FilePath);
            return Results.BadRequest(new
            {
                code = "transcode_failed",
                message = ex.Message,
                exitCode = ex.ExitCode,
            });
        }
    }
}

public sealed record TranscoderStatusDto(
    bool IsReady,
    string? FfmpegPath,
    bool Bundled);

public sealed record ConvertToMp3Request(
    string? OutputFolder,
    int? Bitrate);

public sealed record ConvertToMp3Response(
    string OutputPath,
    long SizeBytes,
    double DurationSeconds);
