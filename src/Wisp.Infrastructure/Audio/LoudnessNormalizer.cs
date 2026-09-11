using System.Diagnostics;
using System.Globalization;
using System.Text.Json;

namespace Wisp.Infrastructure.Audio;

public sealed record LoudnessMeasurement(double IntegratedLufs, double TruePeakDb, double LoudnessRange,
    double Threshold, double TargetOffset, double DurationSeconds);
public sealed record LoudnessRender(LoudnessMeasurement Output, double GainDb, bool Limited);

public interface ILoudnessNormalizer
{
    bool IsAvailable { get; }
    Task<LoudnessMeasurement> MeasureAsync(string source, double target, CancellationToken ct);
    Task<LoudnessRender> RenderAsync(string source, string output, LoudnessMeasurement measured,
        double target, bool allowLimiting, IReadOnlyDictionary<string, string> metadata, CancellationToken ct);
}

/// Whole-track EBU R128 analysis through FFmpeg. Safe mode is constant gain,
/// not loudnorm's implicit dynamic fallback; limiting requires explicit opt-in.
public sealed class LoudnessNormalizer(Mp3Transcoder ffmpeg) : ILoudnessNormalizer
{
    public const string FolderName = "WISP Normalized";
    public const double PeakCeiling = -1;
    public bool IsAvailable => ffmpeg.IsAvailable;
    private static string N(double value) => value.ToString("0.######", CultureInfo.InvariantCulture);
    private const string Format = "aformat=sample_rates=44100:channel_layouts=stereo";

    public static double SafeGain(LoudnessMeasurement input, double target) =>
        Math.Min(target - input.IntegratedLufs, PeakCeiling - 0.2 - input.TruePeakDb);

    public async Task<LoudnessMeasurement> MeasureAsync(string source, double target, CancellationToken ct)
    {
        var result = await Run(source, $"{Format},loudnorm=I={N(target)}:TP={PeakCeiling}:LRA=50:print_format=json",
            null, null, ct);
        return Parse(result.Errors, result.Progress, input: true);
    }

    public async Task<LoudnessRender> RenderAsync(string source, string output, LoudnessMeasurement measured,
        double target, bool allowLimiting, IReadOnlyDictionary<string, string> metadata, CancellationToken ct)
    {
        if (File.Exists(output)) throw new TranscodeException("The output already exists. WISP will not overwrite it.");
        var gain = SafeGain(measured, target);
        var limiting = allowLimiting && gain < target - measured.IntegratedLufs - 0.05;
        var filter = limiting
            ? $"{Format},loudnorm=I={N(target)}:TP=-1.2:LRA=50:measured_I={N(measured.IntegratedLufs)}:measured_TP={N(measured.TruePeakDb)}:measured_LRA={N(measured.LoudnessRange)}:measured_thresh={N(measured.Threshold)}:offset={N(measured.TargetOffset)}:linear=false"
            : $"{Format},volume={N(gain)}dB";
        await Run(source, filter, output, metadata, ct);
        var actual = await MeasureAsync(output, target, ct);
        if (actual.TruePeakDb > PeakCeiling + 0.05)
            throw new TranscodeException("The generated copy exceeded the safe peak ceiling. It was not activated; your original is unchanged.");
        if (Math.Abs(actual.DurationSeconds - measured.DurationSeconds) > 0.05)
            throw new TranscodeException("The generated copy changed duration unexpectedly. It was not activated; your original and cue timing are unchanged.");
        return new(actual, limiting ? actual.IntegratedLufs - measured.IntegratedLufs : gain, limiting);
    }

    public static LoudnessMeasurement Parse(string text, string progress, bool input)
    {
        var start = text.LastIndexOf('{');
        var end = text.LastIndexOf('}');
        if (start < 0 || end <= start) throw new TranscodeException("FFmpeg returned no loudness measurements. Check the audio file and FFmpeg installation.");
        using var json = JsonDocument.Parse(text[start..(end + 1)]);
        double Read(string name)
        {
            if (!json.RootElement.TryGetProperty(name, out var property) ||
                !double.TryParse(property.GetString(), CultureInfo.InvariantCulture, out var value) || !double.IsFinite(value))
                throw new TranscodeException("This track is silent or too quiet to measure reliably. No normalised version was created.");
            return value;
        }
        var prefix = input ? "input_" : "output_";
        var times = progress.Split('\n').Where(l => l.StartsWith("out_time_us=", StringComparison.Ordinal))
            .Select(l => long.TryParse(l[12..].Trim(), CultureInfo.InvariantCulture, out var us) ? us / 1_000_000d : 0);
        var duration = times.DefaultIfEmpty().Max();
        if (duration <= 0) throw new TranscodeException("This file contains no measurable audio.");
        return new(Read(prefix + "i"), Read(prefix + "tp"), Read(prefix + "lra"), Read(prefix + "thresh"), Read("target_offset"), duration);
    }

    private async Task<(string Errors, string Progress)> Run(string source, string filter, string? output,
        IReadOnlyDictionary<string, string>? metadata, CancellationToken ct)
    {
        var executable = ffmpeg.FfmpegPath ?? throw new TranscodeException("FFmpeg is unavailable. Check its path in Settings or install WISP with the bundled audio tools.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromMinutes(30));
        var info = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardError = true, RedirectStandardOutput = true };
        foreach (var arg in new[] { "-hide_banner", "-nostdin", "-xerror", "-nostats", "-i", source,
                     "-map", "0:a:0", "-vn", "-af", filter, "-progress", "pipe:1" }) info.ArgumentList.Add(arg);
        if (output is null) { info.ArgumentList.Add("-f"); info.ArgumentList.Add("null"); info.ArgumentList.Add("-"); }
        else
        {
            foreach (var arg in new[] { "-ar", "44100", "-ac", "2", "-c:a", "pcm_s24le", "-map_metadata", "0" }) info.ArgumentList.Add(arg);
            foreach (var pair in metadata ?? new Dictionary<string, string>())
            { info.ArgumentList.Add("-metadata"); info.ArgumentList.Add($"{pair.Key}={pair.Value}"); }
            // Never overwrite, including in races. Caller owns a unique new path.
            foreach (var arg in new[] { "-f", "wav", "-n", output }) info.ArgumentList.Add(arg);
        }
        using var process = new Process { StartInfo = info };
        try { process.Start(); }
        catch (System.ComponentModel.Win32Exception) { throw new TranscodeException("FFmpeg could not start. Check its configured path."); }
        var errors = process.StandardError.ReadToEndAsync();
        var progress = process.StandardOutput.ReadToEndAsync();
        try
        {
            await process.WaitForExitAsync(timeout.Token);
            var errorText = await errors;
            var progressText = await progress;
            if (process.ExitCode != 0) throw new TranscodeException("FFmpeg could not process this audio. Check for a damaged file, insufficient disk space or an unsupported format.", process.ExitCode, errorText);
            return (errorText, progressText);
        }
        catch (OperationCanceledException)
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            await process.WaitForExitAsync(CancellationToken.None);
            await Task.WhenAll(errors, progress);
            if (!ct.IsCancellationRequested) throw new TranscodeException("Audio processing timed out. Your original is unchanged.");
            throw;
        }
    }

    public static bool IsGeneratedPath(string path) => Path.GetFullPath(path)
        .Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
        .Any(part => string.Equals(part, FolderName, StringComparison.OrdinalIgnoreCase));
}
