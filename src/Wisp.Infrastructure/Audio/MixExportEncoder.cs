using System.Diagnostics;
using System.Globalization;
using NAudio.Wave;

namespace Wisp.Infrastructure.Audio;

/// Single encode from the lossless master, followed by a complete decode check.
/// No normalisation, limiting, shell interpolation, or unbounded audio/log buffers.
public class MixExportEncoder(Mp3Transcoder transcoder)
{
    public const string FolderName = "WISP Mix Exports";
    public static string FileName(string format) => format == "mp3" ? "mix.mp3" : "mix.wav";
    public virtual async Task Encode(string source, string output, string format, int rate, long bytes,
        string title, DateTime recordedAt, Action<double> progress, Action checkSpace, CancellationToken ct)
    {
        var executable = transcoder.FfmpegPath ?? throw new IOException("FFmpeg is unavailable. Check its path in Settings or reinstall WISP with the bundled audio tools. The master is unchanged.");
        var duration = bytes / (rate * 8d);
        if (format == "master")
        {
            await using var input = File.OpenRead(source);
            await using var target = new FileStream(output, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, true);
            var buffer = new byte[65536]; int n; long copied = 0;
            while ((n = await input.ReadAsync(buffer, ct)) > 0)
            { checkSpace(); await target.WriteAsync(buffer.AsMemory(0, n), ct); copied += n; progress(.7 * copied / input.Length); }
            target.Flush(true);
        }
        else
        {
            var args = new List<string> { "-i", source, "-map", "0:a:0", "-vn", "-map_metadata", "-1", "-ac", "2" };
            args.AddRange(format == "mp3"
                ? ["-ar", "44100", "-c:a", "libmp3lame", "-b:a", "320k", "-abr", "0", "-id3v2_version", "3", "-write_xing", "1", "-f", "mp3"]
                : new[] { "-ar", rate.ToString(CultureInfo.InvariantCulture), "-c:a", "pcm_s24le", "-rf64", "never", "-f", "wav" });
            args.AddRange(["-metadata", "title=" + title, "-metadata", "date=" + recordedAt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), "-n", output]);
            await Run(executable, args, duration, p => progress(.7 * p), checkSpace, ct);
        }
        ct.ThrowIfCancellationRequested();
        if (format == "mp3") ValidateMp3(output, ct);
        else if (format == "master") RecordingDiskStore.Validate(output, rate, bytes);
        else
        {
            using var wav = new WaveFileReader(output);
            var pcm = wav.WaveFormat.Encoding == WaveFormatEncoding.Pcm || IsExtensiblePcm(output);
            if (!pcm || wav.WaveFormat.BitsPerSample != 24 ||
                wav.WaveFormat.Channels != 2 || wav.WaveFormat.SampleRate != rate || wav.Length != bytes / 8 * 6)
                throw new IOException($"WAV verification expected stereo 24-bit PCM at {rate} Hz with {bytes / 8 * 6} data bytes; got {wav.WaveFormat.Encoding}, {wav.WaveFormat.BitsPerSample}-bit, {wav.WaveFormat.Channels} channels, {wav.WaveFormat.SampleRate} Hz, {wav.Length} bytes. No export was published.");
        }
        // The decode output's frame count, not just a container duration tag, verifies completeness.
        var decoded = await Run(executable, ["-i", output, "-map", "0:a:0", "-vn", "-f", "f32le", "pipe:1"],
            duration, p => progress(.7 + .25 * p), checkSpace, ct, format == "mp3" ? 44100 : rate);
        if (Math.Abs(decoded - duration) > .05)
            throw new IOException("The exported audio did not decode to the expected duration. No export was published.");
    }

    private static bool IsExtensiblePcm(string path)
    {
        // WaveFileReader exposes fmt extensions as WaveFormatExtraData, not always
        // WaveFormatExtensible. Verify the actual subtype rather than accepting any extension.
        using var file = File.OpenRead(path); using var reader = new BinaryReader(file);
        file.Position = 12;
        while (file.Position + 8 < Math.Min(file.Length, 65536))
        {
            var tag = reader.ReadUInt32(); var length = reader.ReadUInt32();
            if (tag == 0x20746d66) // fmt
            {
                if (length != 40) return false;
                var fmt = reader.ReadBytes(40);
                return fmt.Length == 40 && BitConverter.ToUInt16(fmt, 0) == 0xfffe && BitConverter.ToUInt16(fmt, 18) == 24 &&
                    new Guid(fmt.AsSpan(24, 16)) == NAudio.Dmo.AudioMediaSubtypes.MEDIASUBTYPE_PCM;
            }
            file.Position += length + (length % 2);
        }
        return false;
    }
    public static void ValidateMp3(string path, CancellationToken ct = default)
    {
        using var stream = File.OpenRead(path);
        // Skip ID3v2 using its synchsafe length; inspect every MPEG frame, not average file bitrate.
        var tag = new byte[10]; stream.ReadExactly(tag);
        if (tag[0] == 'I' && tag[1] == 'D' && tag[2] == '3')
            stream.Position = 10L + (tag[6] << 21 | tag[7] << 14 | tag[8] << 7 | tag[9]);
        else stream.Position = 0;
        int count = 0;
        while (Mp3Frame.LoadFromStream(stream) is { } frame)
        {
            ct.ThrowIfCancellationRequested();
            if (frame.BitRate != 320000 || frame.SampleRate != 44100 || frame.ChannelMode == ChannelMode.Mono)
                throw new IOException("MP3 verification failed: expected stereo 44.1 kHz, 320 kbps CBR in every frame.");
            count++;
        }
        if (count == 0) throw new IOException("The MP3 contains no audio frames.");
    }

    private static async Task<double> Run(string executable, IEnumerable<string> args, double duration,
        Action<double> progress, Action checkSpace, CancellationToken ct, int decodedRate = 0)
    {
        var info = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var arg in new[] { "-hide_banner", "-v", "error", "-nostdin", "-xerror", "-nostats" }) info.ArgumentList.Add(arg);
        if (decodedRate == 0) { info.ArgumentList.Add("-progress"); info.ArgumentList.Add("pipe:1"); }
        foreach (var arg in args) info.ArgumentList.Add(arg);
        using var process = new Process { StartInfo = info };
        try { process.Start(); } catch (System.ComponentModel.Win32Exception) { throw new IOException("FFmpeg could not start. Check its path in Settings."); }
        using var kill = ct.Register(() => { try { if (!process.HasExited) process.Kill(true); } catch (InvalidOperationException) { } });
        var errors = Task.Run(async () =>
        {
            var buffer = new char[2048]; string tail = ""; int n;
            while ((n = await process.StandardError.ReadAsync(buffer)) > 0) { tail += new string(buffer, 0, n); if (tail.Length > 4096) tail = tail[^4096..]; }
            return tail;
        });
        double seconds = 0;
        var output = Task.Run(async () =>
        {
            if (decodedRate > 0)
            {
                var buffer = new byte[65536]; long bytes = 0; int n;
                while ((n = await process.StandardOutput.BaseStream.ReadAsync(buffer, ct)) > 0)
                { bytes += n; seconds = bytes / (decodedRate * 8d); progress(Math.Clamp(seconds / duration, 0, 1)); }
                if (bytes == 0 || bytes % 8 != 0) throw new IOException("Export did not decode to complete stereo frames.");
                return;
            }
            while (await process.StandardOutput.ReadLineAsync(ct) is { } line)
                if (line.StartsWith("out_time_us=", StringComparison.Ordinal) && long.TryParse(line[12..], CultureInfo.InvariantCulture, out var us))
                { seconds = Math.Max(seconds, us / 1_000_000d); progress(Math.Clamp(seconds / duration, 0, 1)); }
        });
        try
        {
            while (!process.HasExited) { ct.ThrowIfCancellationRequested(); checkSpace(); await Task.Delay(100, ct); }
            await process.WaitForExitAsync(ct); await output; var error = await errors; ct.ThrowIfCancellationRequested();
            if (process.ExitCode != 0) throw new IOException("FFmpeg could not finish this export. Check free space, the source and encoder availability. " + error);
            return seconds;
        }
        finally
        {
            if (!process.HasExited) process.Kill(true);
            await process.WaitForExitAsync(CancellationToken.None);
            try { await output; } catch (OperationCanceledException) { }
            await errors;
        }
    }
}
