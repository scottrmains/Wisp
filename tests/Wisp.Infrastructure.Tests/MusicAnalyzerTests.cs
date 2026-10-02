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
    [InlineData(".wav")] [InlineData(".aiff")] [InlineData(".flac")] [InlineData(".mp3")]
    public async Task Real_FFmpeg_streams_formats_read_only(string extension)
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
        var hash = SHA256.HashData(await File.ReadAllBytesAsync(source));
        var analyzer = new MusicAnalyzer(new Mp3Transcoder(NullLogger<Mp3Transcoder>.Instance, () => executable));
        var result = await analyzer.AnalyzeAsync(source, true, true, default);
        Assert.InRange(result.Bpm!.Value, 127, 129); Assert.Equal("8A", result.Key);
        Assert.Equal(hash, SHA256.HashData(await File.ReadAllBytesAsync(source)));
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => analyzer.AnalyzeAsync(source, true, true, cancellation.Token));
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
