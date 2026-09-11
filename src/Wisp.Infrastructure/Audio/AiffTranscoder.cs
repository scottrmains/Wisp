using Microsoft.Extensions.Logging;
using NAudio.Wave;

namespace Wisp.Infrastructure.Audio;

/// Transcodes AIFF files to WAV in a per-track cache so the embedded WebView2's
/// `<audio>` element can decode them. Chromium ships no native AIFF decoder.
///
/// Standard PCM AIFF uses a container rewrite with no DSP. Other variants fall
/// back to a 24-bit PCM WAV (not a bit-perfect float export). The source files in the
/// user's library are NEVER modified or moved; the transcoded WAV lives in
/// `%LOCALAPPDATA%\Wisp\transcode\<hash>.wav` and is treated as a throwaway cache.
public sealed class AiffTranscoder(ILogger<AiffTranscoder> log, Mp3Transcoder? ffmpeg = null, string? cacheDirectory = null)
{
    /// Set of extensions the embedded WebView2 doesn't decode natively and that this transcoder handles.
    public static bool IsTranscodeNeeded(string filePath)
    {
        var ext = Path.GetExtension(filePath);
        return ext.Equals(".aiff", StringComparison.OrdinalIgnoreCase)
            || ext.Equals(".aif", StringComparison.OrdinalIgnoreCase);
    }

    /// Returns the path to a browser-playable WAV for the given source file.
    /// Cache keyed on the track's stable file hash so a re-imported file with the same
    /// hash reuses the cached output, while a re-tagged file (different hash) produces a fresh one.
    /// Cache file is created lazily; first call for a given hash does the conversion (~100–500ms
    /// for a typical 5-minute AIFF), subsequent calls are instant.
    public async Task<string> GetOrCreateAsync(string sourcePath, string fileHash, CancellationToken ct)
    {
        if (!IsTranscodeNeeded(sourcePath))
            throw new InvalidOperationException($"{sourcePath} doesn't need transcoding.");

        // Versioned cache avoids accepting output produced by the old converter.
        // Hash the key as well: never allow a caller-supplied key to become a path.
        var sourceInfo = new FileInfo(sourcePath);
        var key = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes($"{fileHash}:{sourceInfo.Length}:{sourceInfo.LastWriteTimeUtc.Ticks}")));
        var directory = cacheDirectory ?? WispPaths.TranscodeDir;
        Directory.CreateDirectory(directory);
        var cachePath = Path.Combine(directory, $"v2-{key}.wav");

        // The key already contains source size and modification time. Never delete
        // a cached WAV another player might be streaming (including future-dated files).
        if (File.Exists(cachePath)) return cachePath;

        // Convert. NAudio handles standard PCM AIFF; FFmpeg handles other variants.
        // WaveFileWriter accepts the same WaveFormat and writes the canonical WAV header.
        // Write to a `.tmp` first then rename atomically so a crashed transcode never leaves
        // a half-written file behind that StreamAudio would happily serve as truncated audio.
        var tempPath = cachePath + $".{Guid.NewGuid():N}.tmp";
        try
        {
            try
            {
                await Task.Run(() =>
                {
                    using var reader = new AiffFileReader(sourcePath);
                    using var writer = new WaveFileWriter(tempPath, reader.WaveFormat);
                    var buffer = new byte[reader.WaveFormat.BlockAlign * 4096];
                    int count;
                    while ((count = reader.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        ct.ThrowIfCancellationRequested();
                        writer.Write(buffer, 0, count);
                    }
                }, ct);
            }
            catch (Exception ex) when (ex is FormatException or InvalidDataException or NotSupportedException)
            {
                log.LogInformation("Using FFmpeg for AIFF variant: {Path}", sourcePath);
                await FfmpegAudio.RunAsync(ffmpeg?.FfmpegPath, sourcePath, tempPath, ct);
            }

            using (var wav = new WaveFileReader(tempPath))
                if (wav.Length == 0) throw new TranscodeException("The file contains no playable audio.");
            ct.ThrowIfCancellationRequested();

            // If a parallel request beat us to it, prefer the existing cache file and discard ours.
            try { File.Move(tempPath, cachePath); }
            catch (IOException) when (File.Exists(cachePath))
            {
                File.Delete(tempPath);
                return cachePath;
            }
            log.LogInformation("Transcoded AIFF → WAV: {Source} → {Cache}", sourcePath, cachePath);
            return cachePath;
        }
        catch
        {
            // Best-effort cleanup; the endpoint returns an actionable decode error.
            try { if (File.Exists(tempPath)) File.Delete(tempPath); } catch { /* ignored */ }
            throw;
        }
    }
}
