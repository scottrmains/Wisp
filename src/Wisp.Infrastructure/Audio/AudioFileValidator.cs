using System.Diagnostics;
using System.Globalization;

namespace Wisp.Infrastructure.Audio;

public interface IAudioFileValidator
{
    Task<TimeSpan> ValidateAsync(string path, CancellationToken ct);
}

/// Fully decode without changing the source. Header-only metadata reads can accept corrupt audio.
public sealed class AudioFileValidator(Mp3Transcoder ffmpeg) : IAudioFileValidator
{
    public async Task<TimeSpan> ValidateAsync(string path, CancellationToken ct)
    {
        var output = await FfmpegAudio.RunAsync(ffmpeg.FfmpegPath, path, null, ct);
        var times = output.Split('\n').Where(l => l.StartsWith("out_time_us=", StringComparison.Ordinal))
            .Select(l => long.TryParse(l[12..].Trim(), CultureInfo.InvariantCulture, out var us) ? us : 0);
        var duration = TimeSpan.FromMicroseconds(times.DefaultIfEmpty().Max());
        if (duration <= TimeSpan.Zero) throw new TranscodeException("The selected file contains no decodable audio.");
        return duration;
    }
}

internal static class FfmpegAudio
{
    // outputPath=null performs validation only; otherwise writes a disposable browser WAV.
    public static async Task<string> RunAsync(string? executable, string source, string? outputPath, CancellationToken ct)
    {
        if (executable is null)
            throw new TranscodeException("FFmpeg is unavailable. Check the FFmpeg path in Settings or reinstall WISP with its bundled audio tools.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromMinutes(3));
        var psi = new ProcessStartInfo(executable)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardError = true, RedirectStandardOutput = true,
        };
        foreach (var arg in new[] { "-hide_banner", "-nostdin", "-v", "error", "-xerror", "-i", source,
                     "-map", "0:a:0", "-vn", "-progress", "pipe:1", "-nostats" }) psi.ArgumentList.Add(arg);
        foreach (var arg in outputPath is null
                     ? new[] { "-f", "null", "-" }
                     : new[] { "-c:a", "pcm_s24le", "-f", "wav", "-y", outputPath }) psi.ArgumentList.Add(arg);
        using var process = new Process { StartInfo = psi };
        try { process.Start(); }
        catch (System.ComponentModel.Win32Exception)
        {
            throw new TranscodeException("FFmpeg could not be started. Check its path in Settings or reinstall WISP's bundled audio tools.");
        }
        var errors = process.StandardError.ReadToEndAsync();
        var output = process.StandardOutput.ReadToEndAsync();
        try
        {
            await process.WaitForExitAsync(timeout.Token);
            var errorText = await errors;
            var progress = await output;
            if (process.ExitCode != 0)
                throw new TranscodeException("The audio could not be decoded. It may be damaged or use an unsupported format. Choose another copy.", process.ExitCode, errorText);
            return progress;
        }
        catch (OperationCanceledException)
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { /* It exited between the check and Kill. */ }
            await process.WaitForExitAsync(CancellationToken.None);
            await Task.WhenAll(errors, output);
            if (ct.IsCancellationRequested) throw;
            throw new TranscodeException("Audio validation timed out. Try a local copy of the file.");
        }
    }
}
