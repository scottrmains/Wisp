using System.Buffers.Binary;
using System.Diagnostics;
using System.Text;
using Wisp.Infrastructure.Audio;

namespace Wisp.Infrastructure.Usb;

public sealed record PioneerWaveform(byte[] Preview, byte[] Tiny, long SampleFrames, DateTimeOffset AnalyzedAt);

public interface IPioneerWaveformAnalyzer
{
    Task<PioneerWaveform> AnalyzeAsync(string audioPath, CancellationToken ct);
}

public sealed class PioneerWaveformException(string message, Exception? inner = null) : InvalidOperationException(message, inner);

/// Decodes the exported audio, never a cached UI waveform or another track's analysis.
/// PCM streams through memory; only 10 ms energy summaries are retained (at most six hours).
/// PWAV packing: Deep-Symmetry/beat-link WaveformPreview; section headers:
/// Deep-Symmetry/crate-digger rekordbox_anlz.ksy. Signal scaling is Wisp's own
/// display curve, not a claim to reproduce rekordbox's proprietary analysis.
public sealed class PioneerWaveformAnalyzer(Mp3Transcoder ffmpeg) : IPioneerWaveformAnalyzer
{
    public async Task<PioneerWaveform> AnalyzeAsync(string audioPath, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var executable = ffmpeg.FfmpegPath ?? throw new PioneerWaveformException(
            "CDJ waveform export needs FFmpeg. Check the FFmpeg path in Settings. The existing USB library has not been replaced.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromMinutes(10));
        var info = new ProcessStartInfo(executable)
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
        };
        foreach (var arg in new[] { "-hide_banner", "-nostdin", "-v", "error", "-xerror", "-i", audioPath,
                     "-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1" })
            info.ArgumentList.Add(arg);
        using var process = new Process { StartInfo = info };
        try { process.Start(); }
        catch (System.ComponentModel.Win32Exception ex)
        { throw new PioneerWaveformException("FFmpeg could not start for CDJ waveform export. Check its path in Settings.", ex); }
        // Drain all stderr, but retain a bounded diagnostic rather than accumulating arbitrary output.
        var errors = DrainErrorsAsync(process.StandardError);
        try
        {
            var waveform = await ReadPcmAsync(process.StandardOutput.BaseStream, timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            var error = await errors;
            if (process.ExitCode != 0)
                throw new PioneerWaveformException($"Could not analyze '{Path.GetFileName(audioPath)}' for CDJ export. FFmpeg reported: {error}");
            return waveform;
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        { throw new PioneerWaveformException($"Waveform analysis timed out for '{Path.GetFileName(audioPath)}'. Try a local, playable copy."); }
        finally
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { /* Already exited. */ }
            await process.WaitForExitAsync(CancellationToken.None);
            await errors;
        }
    }

    private static async Task<string> DrainErrorsAsync(StreamReader reader)
    {
        var retained = new StringBuilder();
        var buffer = new char[2048];
        int read;
        while ((read = await reader.ReadAsync(buffer)) != 0)
            if (retained.Length < 4096) retained.Append(buffer, 0, Math.Min(read, 4096 - retained.Length));
        return retained.ToString().Trim();
    }

    /// <summary>Consumes 44.1 kHz stereo little-endian float PCM, including partial pipe reads.</summary>
    public static async Task<PioneerWaveform> ReadPcmAsync(Stream pcm, CancellationToken ct)
    {
        const int framesPerWindow = 441;
        const long maxFrames = 44100L * 60 * 60 * 6;
        var energy = new List<double>();
        var counts = new List<int>();
        var buffer = new byte[65536 + 8];
        var pending = 0;
        long frames = 0;
        double sum = 0;
        var count = 0;
        while (true)
        {
            var read = await pcm.ReadAsync(buffer.AsMemory(pending, 65536), ct);
            if (read == 0) break;
            var available = read + pending;
            var complete = available - available % 8;
            for (var offset = 0; offset < complete; offset += 8)
            {
                var left = BinaryPrimitives.ReadSingleLittleEndian(buffer.AsSpan(offset, 4));
                var right = BinaryPrimitives.ReadSingleLittleEndian(buffer.AsSpan(offset + 4, 4));
                if (!float.IsFinite(left) || !float.IsFinite(right))
                    throw new PioneerWaveformException("Audio decoder produced invalid samples; CDJ waveform export was stopped.");
                // Measure channels separately: anti-phase stereo must not cancel to silence.
                sum += ((double)left * left + (double)right * right) / 2;
                count++;
                if (++frames > maxFrames) throw new PioneerWaveformException("CDJ waveform export supports tracks up to six hours long.");
                if (count != framesPerWindow) continue;
                energy.Add(sum); counts.Add(count); sum = 0; count = 0;
            }
            pending = available - complete;
            buffer.AsSpan(complete, pending).CopyTo(buffer);
        }
        ct.ThrowIfCancellationRequested();
        if (pending != 0 || frames == 0) throw new PioneerWaveformException("No complete audio could be decoded for the CDJ waveform.");
        if (count > 0) { energy.Add(sum); counts.Add(count); }

        byte[] Preview(int columns, int maxHeight, bool color)
        {
            var result = new byte[columns];
            // Weight partial windows at each column boundary. Scale by actual decoded
            // frames, not potentially stale library duration; include the final tail.
            for (var column = 0; column < columns; column++)
            {
                double start = (double)frames * column / columns, end = (double)frames * (column + 1) / columns;
                double total = 0;
                for (var window = (int)(start / framesPerWindow); window < energy.Count && window * (double)framesPerWindow < end; window++)
                {
                    var overlap = Math.Min(end, window * (double)framesPerWindow + counts[window]) - Math.Max(start, window * (double)framesPerWindow);
                    if (overlap > 0) total += energy[window] * overlap / counts[window];
                }
                // Fixed square-root RMS display curve: no per-track gain normalization.
                // Quiet passages stay visibly quieter; true silence remains zero.
                var height = Math.Clamp((int)Math.Round(maxHeight * Math.Pow(Math.Clamp(total / (end - start), 0, 1), 0.25)), 0, maxHeight);
                result[column] = (byte)(height | (color && height > 0 ? 3 << 5 : 0));
            }
            return result;
        }
        // PWAV: 400 columns, low 5 bits height + high 3 bits whiteness.
        // PWV2: 100 monochrome columns, low nibble, matching the private reference.
        return new(Preview(400, 31, true), Preview(100, 15, false), frames, DateTimeOffset.UtcNow);
    }
}
