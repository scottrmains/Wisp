using Microsoft.Extensions.Logging;
using NAudio.Wave;

namespace Wisp.Infrastructure.Audio;

/// Transcodes AIFF files to WAV in a per-track cache so the embedded WebView2's
/// `<audio>` element can decode them. Chromium ships no native AIFF decoder.
///
/// AIFF is uncompressed PCM in an IFF wrapper, so this is essentially a container
/// rewrite — bit-perfect, no DSP, no quality loss. The on-disk source files in the
/// user's library are NEVER modified or moved; the transcoded WAV lives in
/// `%LOCALAPPDATA%\Wisp\transcode\<hash>.wav` and is treated as a throwaway cache.
public sealed class AiffTranscoder(ILogger<AiffTranscoder> log)
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

        var cachePath = Path.Combine(WispPaths.TranscodeDir, $"{fileHash}.wav");

        // Already cached and the source hasn't been touched since? Use it.
        if (File.Exists(cachePath))
        {
            try
            {
                var srcWritten = File.GetLastWriteTimeUtc(sourcePath);
                var cacheWritten = File.GetLastWriteTimeUtc(cachePath);
                // If the source is newer than the cache, the cache is stale (the hash should have
                // changed too, but defend against the rare case where it hasn't yet).
                if (cacheWritten >= srcWritten) return cachePath;
                log.LogDebug("AIFF cache stale for {Path}; regenerating", sourcePath);
                File.Delete(cachePath);
            }
            catch (Exception ex)
            {
                log.LogDebug(ex, "Cache freshness check failed for {Path}; regenerating", cachePath);
            }
        }

        // Convert. NAudio's AiffFileReader handles AIFF + AIFF-C, big- and little-endian.
        // WaveFileWriter accepts the same WaveFormat and writes the canonical WAV header.
        // Write to a `.tmp` first then rename atomically so a crashed transcode never leaves
        // a half-written file behind that StreamAudio would happily serve as truncated audio.
        var tempPath = cachePath + ".tmp";
        try
        {
            await Task.Run(() =>
            {
                using var reader = new AiffFileReader(sourcePath);
                WaveFileWriter.CreateWaveFile(tempPath, reader);
            }, ct);

            // If a parallel request beat us to it, prefer the existing cache file and discard ours.
            if (File.Exists(cachePath))
            {
                File.Delete(tempPath);
                return cachePath;
            }
            File.Move(tempPath, cachePath);
            log.LogInformation("Transcoded AIFF → WAV: {Source} → {Cache}", sourcePath, cachePath);
            return cachePath;
        }
        catch
        {
            // Best-effort cleanup; rethrow so the endpoint can return 500 with context.
            try { if (File.Exists(tempPath)) File.Delete(tempPath); } catch { /* ignored */ }
            throw;
        }
    }
}
