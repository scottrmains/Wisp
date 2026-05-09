using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace Wisp.Infrastructure.Audio;

/// Thrown when FFmpeg returns a non-zero exit code or can't be found.
/// API endpoints catch this and surface a clean error code instead of a 500.
public sealed class TranscodeException(string message, int exitCode = -1, string? stderr = null)
    : Exception(message)
{
    public int ExitCode { get; } = exitCode;
    public string? StdErr { get; } = stderr;
}

public sealed record TranscodeResult(
    string OutputPath,
    long SizeBytes,
    TimeSpan Duration);

/// Drives `ffmpeg.exe` to transcode arbitrary audio (FLAC / WAV / AIFF / OGG / etc.)
/// into MP3 320 kbps for export to DJ hardware that can't read FLAC.
///
/// **Discovery order** (first match wins):
///   1. `WispSettings.FfmpegPath` — user override, paste an existing install
///   2. `AppContext.BaseDirectory/ffmpeg.exe` — the bundled binary alongside Wisp.exe
///   3. `PATH` — for users who already have FFmpeg installed system-wide
///
/// **Cost note**: each call spawns a process. For ~5-minute tracks at 320 CBR
/// expect ~10 s on a typical laptop. Caller is responsible for surfacing a
/// progress UI via `IProgress<double>`.
public sealed class Mp3Transcoder
{
    private readonly ILogger<Mp3Transcoder> _log;
    private readonly Func<string?> _settingsPathProvider;

    public Mp3Transcoder(ILogger<Mp3Transcoder> log, Func<string?> settingsPathProvider)
    {
        _log = log;
        _settingsPathProvider = settingsPathProvider;
    }

    /// True when FFmpeg is reachable on disk via the discovery chain.
    public bool IsAvailable => ResolveFfmpegPath() is not null;

    /// Path to whatever ffmpeg.exe the discovery chain found, or null if none.
    /// Used by the Settings panel to show "✓ detected · {path}" status.
    public string? FfmpegPath => ResolveFfmpegPath();

    /// True when the resolved binary is the one bundled alongside Wisp.exe
    /// (rather than a user override or PATH-installed copy). Drives the
    /// "bundled" badge in the Settings UI.
    public bool IsBundled
    {
        get
        {
            var path = ResolveFfmpegPath();
            if (path is null) return false;
            var bundled = Path.Combine(AppContext.BaseDirectory, BundledExeName);
            return string.Equals(Path.GetFullPath(path), Path.GetFullPath(bundled), StringComparison.OrdinalIgnoreCase);
        }
    }

    /// Convert `inputPath` to MP3 in `outputDir`. The output filename is
    /// derived from `desiredBaseName` (typically "Artist - Title") with FS-
    /// reserved chars stripped. Conflict-safe: if the target exists, suffix
    /// with `(2)`, `(3)`, … until a free slot is found.
    public async Task<TranscodeResult> ConvertAsync(
        string inputPath,
        string outputDir,
        string desiredBaseName,
        int bitrateKbps,
        IProgress<double>? progress,
        CancellationToken ct)
    {
        var ffmpeg = ResolveFfmpegPath()
            ?? throw new TranscodeException("FFmpeg not found. Run tools/get-ffmpeg.ps1 or set Settings → FfmpegPath.");
        if (!File.Exists(inputPath))
            throw new TranscodeException($"Input file not found: {inputPath}");
        if (bitrateKbps is < 64 or > 320)
            throw new TranscodeException($"Bitrate must be 64–320, got {bitrateKbps}.");

        Directory.CreateDirectory(outputDir);
        var outputPath = NextFreePath(outputDir, SanitizeFileName(desiredBaseName), ".mp3");

        // Read source duration up-front so we can render a determinate
        // progress bar against ffmpeg's `time=` stderr emissions.
        var totalDuration = await ProbeDurationAsync(ffmpeg, inputPath, ct);

        // -map_metadata 0 carries artist / title / BPM / key / energy across
        // (the FLAC tag fields → ID3v2 frames). -id3v2_version 3 forces
        // ID3v2.3 which Pioneer hardware reads more reliably than v2.4.
        // -y overwrites the output silently — we already chose a free path.
        var args = string.Join(' ',
            "-hide_banner",
            "-nostdin",
            "-i", Quote(inputPath),
            "-c:a", "libmp3lame",
            "-b:a", $"{bitrateKbps}k",
            "-map_metadata", "0",
            "-id3v2_version", "3",
            "-y",
            Quote(outputPath));

        var psi = new ProcessStartInfo
        {
            FileName = ffmpeg,
            Arguments = args,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
        };

        using var proc = new Process { StartInfo = psi };
        var stderrBuf = new StringBuilder();

        proc.ErrorDataReceived += (_, e) =>
        {
            if (e.Data is null) return;
            stderrBuf.AppendLine(e.Data);
            if (progress is not null && totalDuration > TimeSpan.Zero)
            {
                var match = TimeRegex.Match(e.Data);
                if (match.Success && TimeSpan.TryParse(match.Groups[1].Value, out var done))
                {
                    var ratio = Math.Clamp(done.TotalSeconds / totalDuration.TotalSeconds, 0.0, 1.0);
                    progress.Report(ratio);
                }
            }
        };

        proc.Start();
        proc.BeginErrorReadLine();
        // Drain stdout so ffmpeg doesn't block on a full pipe buffer; we
        // don't actually use anything from it.
        _ = proc.StandardOutput.ReadToEndAsync(ct);

        await proc.WaitForExitAsync(ct);

        if (proc.ExitCode != 0)
        {
            var stderr = stderrBuf.ToString();
            _log.LogWarning("FFmpeg failed for {Input}: exit {Code}\n{Stderr}", inputPath, proc.ExitCode, stderr);
            // Best-effort cleanup of the partial output so we don't serve
            // truncated audio if a future caller picks it up.
            TryDelete(outputPath);
            throw new TranscodeException(
                $"FFmpeg failed (exit {proc.ExitCode}). See log for details.",
                proc.ExitCode,
                stderr);
        }

        progress?.Report(1.0);

        var info = new FileInfo(outputPath);
        return new TranscodeResult(outputPath, info.Length, totalDuration);
    }

    /// Runs `ffmpeg -i {input}` purely to read the duration line out of stderr.
    /// Cheap enough — ffmpeg exits with non-zero after printing metadata when
    /// no output is specified, which is what we exploit.
    private static async Task<TimeSpan> ProbeDurationAsync(string ffmpeg, string input, CancellationToken ct)
    {
        var psi = new ProcessStartInfo
        {
            FileName = ffmpeg,
            Arguments = $"-hide_banner -nostdin -i {Quote(input)}",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
        };
        using var proc = new Process { StartInfo = psi };
        proc.Start();
        var stderr = await proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);

        var match = DurationRegex.Match(stderr);
        if (match.Success && TimeSpan.TryParse(match.Groups[1].Value, out var d)) return d;
        return TimeSpan.Zero; // unknown — progress will stay indeterminate
    }

    private string? ResolveFfmpegPath()
    {
        // 1. User override
        var setting = _settingsPathProvider();
        if (!string.IsNullOrWhiteSpace(setting) && File.Exists(setting)) return setting;

        // 2. Bundled binary
        var bundled = Path.Combine(AppContext.BaseDirectory, BundledExeName);
        if (File.Exists(bundled)) return bundled;

        // 3. PATH
        var pathEnv = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrEmpty(pathEnv)) return null;
        var separator = Path.PathSeparator;
        foreach (var dir in pathEnv.Split(separator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var candidate = Path.Combine(dir.Trim('"'), BundledExeName);
                if (File.Exists(candidate)) return candidate;
            }
            catch
            {
                // Malformed PATH entries (e.g. with stray characters) — ignore.
            }
        }
        return null;
    }

    /// Strip filesystem-reserved characters and trim. Mirrors what TagLib /
    /// the rest of Wisp does for cleanup file rename.
    private static string SanitizeFileName(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "track";
        var sb = new StringBuilder(raw.Length);
        foreach (var c in raw)
        {
            if (c == '<' || c == '>' || c == ':' || c == '"' || c == '/' || c == '\\' || c == '|' || c == '?' || c == '*')
                continue;
            if (c < 0x20) continue; // control chars
            sb.Append(c);
        }
        var cleaned = sb.ToString().Trim().TrimEnd('.');
        return string.IsNullOrEmpty(cleaned) ? "track" : cleaned;
    }

    /// Returns `dir/base.ext` if free, else `dir/base (2).ext`, `dir/base (3).ext`, ….
    private static string NextFreePath(string dir, string baseName, string ext)
    {
        var attempt = Path.Combine(dir, $"{baseName}{ext}");
        if (!File.Exists(attempt)) return attempt;
        for (var i = 2; i <= 999; i++)
        {
            attempt = Path.Combine(dir, $"{baseName} ({i}){ext}");
            if (!File.Exists(attempt)) return attempt;
        }
        // Vanishingly unlikely but a defensible fallback.
        return Path.Combine(dir, $"{baseName} ({Guid.NewGuid():N}){ext}");
    }

    private static string Quote(string path) => '"' + path.Replace("\"", "\\\"") + '"';

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { /* swallow */ }
    }

    private const string BundledExeName = "ffmpeg.exe";

    /// Matches FFmpeg's `time=00:00:42.50` progress emission on stderr.
    private static readonly Regex TimeRegex = new(@"time=(\d{2}:\d{2}:\d{2}\.\d{2})", RegexOptions.Compiled);
    /// Matches the `Duration: 00:05:24.13,` line emitted on probe.
    private static readonly Regex DurationRegex = new(@"Duration:\s+(\d{2}:\d{2}:\d{2}\.\d{2})", RegexOptions.Compiled);
}
