using System.Globalization;
using Microsoft.Extensions.Logging.Abstractions;
using NAudio.Wave;
using Wisp.Infrastructure.Audio;

namespace Wisp.Infrastructure.Tests;

public sealed class LoudnessNormalizerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wisp-loudness-audio-" + Guid.NewGuid().ToString("N"));
    private readonly LoudnessNormalizer _normalizer = new(new Mp3Transcoder(NullLogger<Mp3Transcoder>.Instance,
        () => Environment.GetEnvironmentVariable("WISP_TEST_FFMPEG")));

    public LoudnessNormalizerTests() { Directory.CreateDirectory(_root); }

    private string Signal(bool peaks = false, bool silent = false)
    {
        var path = Path.Combine(_root, $"Vinyl 'quote' 音楽 {Guid.NewGuid():N}.wav");
        using var writer = new WaveFileWriter(path, new WaveFormat(44100, 16, 2));
        for (var i = 0; i < 44100 * 12; i++)
        {
            var amplitude = silent ? 0 : peaks && i % 44100 < 100 ? 0.88 : 0.02;
            var sample = (float)(amplitude * Math.Sin(2 * Math.PI * 1000 * i / 44100));
            writer.WriteSample(sample); writer.WriteSample(sample);
        }
        return path;
    }

    [Fact]
    public async Task Real_ffmpeg_safe_gain_matches_target_without_changing_source_duration_or_format_contract()
    {
        Assert.True(_normalizer.IsAvailable, "Install FFmpeg or set WISP_TEST_FFMPEG for audio integration tests.");
        var source = Signal(); var original = await File.ReadAllBytesAsync(source);
        var measured = await _normalizer.MeasureAsync(source, -14, default);
        Assert.True(measured.IntegratedLufs < -25);
        var output = Path.Combine(_root, "copy.wav");
        var result = await _normalizer.RenderAsync(source, output, measured, -14, false, new Dictionary<string, string> { ["title"] = "Curated title" }, default);
        Assert.False(result.Limited); Assert.True(result.GainDb > 0);
        Assert.InRange(result.Output.IntegratedLufs, -14.3, -13.7);
        Assert.True(result.Output.TruePeakDb <= -1);
        using var reader = new WaveFileReader(output);
        Assert.Equal(44100, reader.WaveFormat.SampleRate); Assert.Equal(24, reader.WaveFormat.BitsPerSample); Assert.Equal(2, reader.WaveFormat.Channels);
        Assert.InRange(reader.TotalTime.TotalSeconds, 11.99, 12.01);
        Assert.Equal(original, await File.ReadAllBytesAsync(source));
        await Assert.ThrowsAsync<TranscodeException>(() => _normalizer.RenderAsync(source, output, measured, -14, false, new Dictionary<string, string>(), default));
    }

    [Fact]
    public async Task Peak_limited_source_is_not_silently_compressed_but_explicit_limiting_can_raise_loudness()
    {
        var source = Signal(peaks: true);
        var measured = await _normalizer.MeasureAsync(source, -14, default);
        var safe = await _normalizer.RenderAsync(source, Path.Combine(_root, "safe.wav"), measured, -14, false, new Dictionary<string, string>(), default);
        Assert.False(safe.Limited); Assert.True(safe.Output.IntegratedLufs < -15);
        var limited = await _normalizer.RenderAsync(source, Path.Combine(_root, "limited.wav"), measured, -14, true, new Dictionary<string, string>(), default);
        Assert.True(limited.Limited); Assert.True(limited.Output.IntegratedLufs > safe.Output.IntegratedLufs);
        Assert.InRange(limited.Output.IntegratedLufs, -15, -13);
        Assert.True(limited.Output.TruePeakDb <= -1);
    }

    [Fact]
    public async Task Silence_and_cancellation_cannot_produce_a_successful_analysis()
    {
        await Assert.ThrowsAsync<TranscodeException>(() => _normalizer.MeasureAsync(Signal(silent: true), -14, default));
        using var cancel = new CancellationTokenSource(); cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => _normalizer.MeasureAsync(Signal(), -14, cancel.Token));
    }

    [Fact]
    public void Gain_and_measurement_parsing_are_culture_independent_and_reject_nonfinite_values()
    {
        var old = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("fr-FR");
            const string json = "log {\"input_i\":\"-20.5\",\"input_tp\":\"-2.0\",\"input_lra\":\"5.1\",\"input_thresh\":\"-30.2\",\"target_offset\":\"0.1\"}";
            var data = LoudnessNormalizer.Parse(json, "out_time_us=12000000", true);
            Assert.Equal(-20.5, data.IntegratedLufs); Assert.Equal(0.8, LoudnessNormalizer.SafeGain(data, -14), 5);
            Assert.Throws<TranscodeException>(() => LoudnessNormalizer.Parse(json.Replace("-20.5", "-inf"), "out_time_us=12000000", true));
        }
        finally { CultureInfo.CurrentCulture = old; }
    }

    public void Dispose() => Directory.Delete(_root, true);
}
