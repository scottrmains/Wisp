using System.Diagnostics;
using System.Security.Cryptography;
using Microsoft.Extensions.Logging.Abstractions;
using NAudio.Wave;
using Wisp.Infrastructure.Audio;

namespace Wisp.Infrastructure.Tests;

public sealed class MusicAnalyzerTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "wisp-music-analysis-" + Guid.NewGuid().ToString("N"));
    private static float Signal(double time, double bpm, int rootNote, bool minor, bool beat = true)
    {
        var notes = new[] { rootNote, rootNote + (minor ? 3 : 4), rootNote + 7 };
        var tone = notes.Sum(note => Math.Sin(2 * Math.PI * 440 * Math.Pow(2, (note - 69) / 12d) * time)) * 0.07;
        var phase = time % (60 / bpm);
        var kick = beat && phase < 0.05 ? Math.Exp(-phase * 80) * Math.Sin(2 * Math.PI * 80 * phase) * 0.7 : 0;
        return (float)(tone + kick);
    }

    [Theory]
    [InlineData(100)] [InlineData(120)] [InlineData(125)] [InlineData(128)] [InlineData(140)] [InlineData(170)]
    public void Synthetic_steady_pulse_tempo_is_close_or_octave_equivalent(double bpm)
    {
        var features = new MusicFeatures(true, false);
        for (var i = 0; i < MusicFeatures.SampleRate * 40; i++)
            features.Add(Signal((double)i / MusicFeatures.SampleRate, bpm, 60, false));
        var result = features.Finish();
        Assert.NotNull(result.Bpm);
        var actual = (double)result.Bpm.Value;
        Assert.True(new[] { actual, actual / 2, actual * 2 }.Any(v => Math.Abs(v - bpm) < 0.15), $"Expected {bpm} BPM (or octave); got {actual}");
        Assert.Null(result.Key);
        Assert.InRange(result.TempoStrength, 0, 1);
    }

    [Theory]
    [InlineData(60, false, "8B")] [InlineData(69, true, "8A")]
    [InlineData(62, true, "7A")] [InlineData(67, false, "9B")]
    public void Synthetic_major_minor_triads_map_to_Camelot(int note, bool minor, string expected)
    {
        var features = new MusicFeatures(false, true);
        for (var i = 0; i < MusicFeatures.SampleRate * 12; i++)
            features.Add(Signal((double)i / MusicFeatures.SampleRate, 128, note, minor, beat: false));
        var result = features.Finish();
        Assert.Equal(expected, result.Key); Assert.Null(result.Bpm); Assert.True(result.KeyUncertain);
        Assert.InRange(result.KeyStrength, 0, 1);
    }

    [Fact]
    public void Silence_short_audio_and_non_rhythmic_audio_do_not_invent_a_tempo()
    {
        var silence = new MusicFeatures(true, true);
        for (var i = 0; i < MusicFeatures.SampleRate * 10; i++) silence.Add(0);
        Assert.Throws<IOException>(() => silence.Finish());
        Assert.Throws<IOException>(() => new MusicFeatures(true, true).Finish());
        var constant = new MusicFeatures(true, false);
        for (var i = 0; i < MusicFeatures.SampleRate * 10; i++) constant.Add(0.2f);
        Assert.Null(constant.Finish().Bpm);
    }

    [Theory]
    [InlineData(125, 166.6666667)]
    [InlineData(125, 187.5)]
    [InlineData(166.5, 222)]
    public void Bass_pulse_is_not_replaced_by_louder_rhythmic_subdivisions(double bpm, double hatsBpm)
    {
        var features = new MusicFeatures(true, false);
        for (var i = 0; i < MusicFeatures.SampleRate * 65; i++)
        {
            var time = (double)i / MusicFeatures.SampleRate;
            var phase = time % (60 / hatsBpm);
            var hat = phase < 0.025 ? 0.9 * Math.Exp(-phase * 180) * Math.Sin(2 * Math.PI * 3100 * phase) : 0;
            features.Add((float)(Signal(time, bpm, 60, false) + hat));
        }
        var result = features.Finish();
        Assert.InRange((double)result.Bpm!.Value, bpm - 0.2, bpm + 0.2);
    }

    [Theory]
    [InlineData(-35)] [InlineData(35)]
    public void Detuned_minor_triad_has_tuning_correction_and_explicit_review(double cents)
    {
        var features = new MusicFeatures(false, true);
        for (var i = 0; i < MusicFeatures.SampleRate * 15; i++)
            features.Add(Signal((double)i / MusicFeatures.SampleRate * Math.Pow(2, cents / 1200), 128, 69, true, false));
        var result = features.Finish();
        Assert.Equal("8A", result.Key);
        Assert.InRange(result.TuningCents!.Value, cents - 5, cents + 5);
        Assert.True(result.KeyUncertain);
        Assert.InRange(result.KeyAgreement!.Value, 0, 1);
    }

    [Fact]
    public void Changing_tonal_sections_are_flagged_instead_of_treated_as_one_certain_key()
    {
        var features = new MusicFeatures(false, true);
        for (var i = 0; i < MusicFeatures.SampleRate * 65; i++)
        {
            var time = (double)i / MusicFeatures.SampleRate;
            features.Add(Signal(time, 125, time < 30 ? 69 : 66, time < 30, false));
        }
        var result = features.Finish();
        Assert.NotNull(result.KeyWarning);
        Assert.InRange(result.KeyAgreement!.Value, 0, 0.65);
        Assert.True(result.KeyUncertain);
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        Assert.Throws<OperationCanceledException>(() => features.Finish(cancelled.Token));
    }

    [Fact]
    public void Single_pitch_does_not_invent_a_key()
    {
        var features = new MusicFeatures(false, true);
        for (var i = 0; i < MusicFeatures.SampleRate * 15; i++)
            features.Add((float)(0.2 * Math.Sin(2 * Math.PI * 440 * i / MusicFeatures.SampleRate)));
        Assert.Null(features.Finish().Key);
    }

    public static IEnumerable<object[]> AllKeys() => new[] {
        "8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B",
        "5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"
    }.Select((code, index) => new object[] { 48 + index % 12, index >= 12, code });

    [Theory]
    [MemberData(nameof(AllKeys))]
    public void Spectral_detector_maps_all_24_keys_without_external_tags(int rootNote, bool minor, string expected)
    {
        var features = new MusicFeatures(false, true);
        for (var i = 0; i < MusicFeatures.SampleRate * 12; i++)
            features.Add(Signal((double)i / MusicFeatures.SampleRate, 125, rootNote, minor, false));
        var result = features.Finish();
        Assert.Equal(expected, result.Key);
        Assert.Equal(MusicFeatures.Engine, result.Engine);
        Assert.NotEqual("wisp-multiband-tonal-v2", result.Engine);
        Assert.Equal(result, features.Finish()); // final partial hop is incorporated exactly once
    }

    [Fact]
    public void Quiet_tonal_body_after_a_long_percussive_intro_is_not_skipped()
    {
        var features = new MusicFeatures(false, true);
        for (var i = 0; i < MusicFeatures.SampleRate * 95; i++)
        {
            var time = (double)i / MusicFeatures.SampleRate;
            var phase = time % 0.48;
            var drum = phase < 0.06 ? 0.8 * Math.Exp(-phase * 100) * Math.Sin(2 * Math.PI * 80 * phase) : 0;
            features.Add((float)(time < 35 ? drum : Signal(time, 125, 69, true, false) * 0.2));
        }
        Assert.Equal("8A", features.Finish().Key);
    }

    [Fact]
    public void Broadband_noise_does_not_invent_a_tonal_key()
    {
        var random = new Random(20261003);
        var features = new MusicFeatures(false, true);
        for (var i = 0; i < MusicFeatures.SampleRate * 60; i++) features.Add((float)(random.NextDouble() * 0.2 - 0.1));
        Assert.Null(features.Finish().Key);
    }

    [Fact]
    public void Enabling_key_detection_does_not_change_the_tempo_estimate()
    {
        var bpmOnly = new MusicFeatures(true, false);
        var combined = new MusicFeatures(true, true);
        for (var i = 0; i < MusicFeatures.SampleRate * 40; i++)
        {
            var sample = Signal((double)i / MusicFeatures.SampleRate, 125, 69, true);
            bpmOnly.Add(sample); combined.Add(sample);
        }
        var first = bpmOnly.Finish(); var second = combined.Finish();
        Assert.Equal(first.Bpm, second.Bpm);
        Assert.Equal(first.TempoStrength, second.TempoStrength);
        Assert.Equal(first.TempoUncertain, second.TempoUncertain);
    }

    [Theory]
    [InlineData(".wav")] [InlineData(".aiff")] [InlineData(".flac")] [InlineData(".mp3")]
    public async Task Real_FFmpeg_streams_formats_read_only(string extension)
    {
        var source = await CreateSignalFile(extension);
        var hash = SHA256.HashData(await File.ReadAllBytesAsync(source));
        var analyzer = CreateAnalyzer();
        var result = await analyzer.AnalyzeAsync(source, true, true, default);
        Assert.InRange(result.Bpm!.Value, 127, 129); Assert.Equal("8A", result.Key);
        Assert.Null(result.DecodeWarning);
        Assert.Equal(hash, SHA256.HashData(await File.ReadAllBytesAsync(source)));
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => analyzer.AnalyzeAsync(source, true, true, cancellation.Token));
    }

    private static MusicAnalyzer CreateAnalyzer() => new(new Mp3Transcoder(NullLogger<Mp3Transcoder>.Instance,
        () => Environment.GetEnvironmentVariable("WISP_TEST_FFMPEG")));

    private async Task<string> CreateSignalFile(string extension)
    {
        Directory.CreateDirectory(root);
        var wave = Path.Combine(root, "signal.wav");
        using (var writer = new WaveFileWriter(wave, WaveFormat.CreateIeeeFloatWaveFormat(44100, 2)))
            for (var i = 0; i < 44100 * 20; i++)
            { var sample = Signal((double)i / 44100, 128, 69, true); writer.WriteSample(sample); writer.WriteSample(sample); }
        var executable = Environment.GetEnvironmentVariable("WISP_TEST_FFMPEG");
        Assert.True(File.Exists(executable), "Set WISP_TEST_FFMPEG to run decoder integration tests.");
        var source = wave;
        if (extension != ".wav")
        {
            source = Path.Combine(root, "converted" + extension);
            using var process = new Process { StartInfo = new(executable!) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true } };
            foreach (var arg in new[] { "-v", "error", "-i", wave, "-c:a", extension == ".aiff" ? "pcm_s16be" : extension == ".flac" ? "flac" : "libmp3lame", source }) process.StartInfo.ArgumentList.Add(arg);
            process.Start(); var errors = process.StandardError.ReadToEndAsync(); await process.WaitForExitAsync();
            Assert.True(process.ExitCode == 0, await errors);
        }
        return source;
    }

    [Fact]
    public async Task Isolated_bad_MP3_packet_recovers_with_explicit_review_and_without_rewriting_source()
    {
        var source = await CreateSignalFile(".mp3");
        // Simulate an invalid trailing packet, not a pristine MP3 or user-owned music.
        await using (var append = new FileStream(source, FileMode.Append))
            await append.WriteAsync(new byte[1024]);
        var hash = SHA256.HashData(await File.ReadAllBytesAsync(source));
        var analyzer = CreateAnalyzer();
        var result = await analyzer.AnalyzeAsync(source, true, true, default);
        Assert.InRange(result.Bpm!.Value, 127, 129);
        Assert.InRange(result.Seconds, 19, 21);
        Assert.NotNull(result.DecodeWarning);
        Assert.True(result.TempoUncertain); Assert.True(result.KeyUncertain);
        Assert.Equal(hash, SHA256.HashData(await File.ReadAllBytesAsync(source)));
    }

    [Theory]
    [InlineData(8, false)] [InlineData(9, true)] [InlineData(100, true)]
    public async Task Failed_MP3_packet_budget_is_enforced(int failures, bool rejected)
    {
        var source = await CreateSignalFile(".mp3");
        // Valid MPEG-1 layer III frame headers, deliberately invalid all-ones side information.
        var frame = Enumerable.Repeat((byte)255, 417).ToArray();
        frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90; frame[3] = 0x64;
        await using (var append = new FileStream(source, FileMode.Append))
            for (var i = 0; i < failures; i++) await append.WriteAsync(frame);
        var hash = SHA256.HashData(await File.ReadAllBytesAsync(source));
        var analyzer = CreateAnalyzer();
        if (rejected)
        {
            var error = await Assert.ThrowsAsync<IOException>(() => analyzer.AnalyzeAsync(source, true, true, default));
            Assert.Contains("too many decoding errors", error.Message);
        }
        else
        {
            var result = await analyzer.AnalyzeAsync(source, true, true, default);
            Assert.NotNull(result.DecodeWarning); Assert.True(result.TempoUncertain);
        }
        Assert.Equal(hash, SHA256.HashData(await File.ReadAllBytesAsync(source)));
    }

    [Fact]
    public async Task Corrupt_audio_returns_an_actionable_failure()
    {
        Directory.CreateDirectory(root); var source = Path.Combine(root, "bad.wav");
        await File.WriteAllTextAsync(source, "not an audio file");
        var analyzer = new MusicAnalyzer(new Mp3Transcoder(NullLogger<Mp3Transcoder>.Instance, () => Environment.GetEnvironmentVariable("WISP_TEST_FFMPEG")));
        await Assert.ThrowsAsync<IOException>(() => analyzer.AnalyzeAsync(source, true, true, default));
    }

    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, true); }
}
