using System.Diagnostics;
using System.Text.RegularExpressions;
using Wisp.Infrastructure.Audio;

namespace Wisp.Infrastructure.FileSystem;

/// Hash demuxed audio packets, excluding tags, artwork and container offsets.
/// Versioned because a future fingerprint algorithm must not silently reinterpret old IDs.
public sealed class AudioContentFingerprint(Mp3Transcoder ffmpeg)
{
    public bool IsAvailable => ffmpeg.IsAvailable;
    public async Task<string> ComputeAsync(string path, CancellationToken ct)
    {
        var executable = ffmpeg.FfmpegPath ?? throw new IOException("FFmpeg is needed to initialise track identity.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromMinutes(2));
        using var process = new Process { StartInfo = new ProcessStartInfo(executable)
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        foreach (var arg in new[] { "-nostdin", "-v", "error", "-xerror", "-i", path, "-map", "0:a:0", "-c:a", "copy", "-f", "hash", "-hash", "sha256", "-" })
            process.StartInfo.ArgumentList.Add(arg);
        process.Start();
        var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
        var errors = process.StandardError.ReadToEndAsync(timeout.Token);
        try
        {
            await process.WaitForExitAsync(timeout.Token);
            var hash = (await output).Trim();
            var error = await errors;
            if (process.ExitCode != 0 || !Regex.IsMatch(hash, @"^SHA256=[0-9a-fA-F]{64}$"))
                throw new IOException("Could not fingerprint audio: " + error[..Math.Min(error.Length, 500)]);
            using var media = TagLib.File.Create(path);
            var props = media.Properties;
            if (props.Duration <= TimeSpan.Zero || props.AudioSampleRate <= 0 || props.AudioChannels <= 0)
                throw new IOException("Audio has no valid duration, sample rate or channels.");
            var format = Path.GetExtension(path).ToLowerInvariant();
            if (format == ".aif") format = ".aiff";
            var formatSignature = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(
                $"{format}|{props.AudioSampleRate}|{props.AudioChannels}|{props.BitsPerSample}|{props.Description}"));
            return $"audio-packets-v1:{Convert.ToHexString(formatSignature)}:{hash[7..].ToUpperInvariant()}";
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        { throw new IOException("Audio identity analysis timed out."); }
        finally
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
        }
    }
}
