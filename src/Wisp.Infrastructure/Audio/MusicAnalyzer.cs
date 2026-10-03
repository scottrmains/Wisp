using System.Diagnostics;
using NAudio.Dsp;

namespace Wisp.Infrastructure.Audio;

public sealed record MusicAnalysis(decimal? Bpm, string? Key, double TempoStrength, double KeyStrength,
    bool TempoUncertain, bool KeyUncertain, double Seconds, string Engine);

public interface IMusicAnalyzer
{
    bool IsAvailable { get; }
    Task<MusicAnalysis> AnalyzeAsync(string path, bool bpm, bool key, CancellationToken ct);
}

/// Read-only, streaming PCM analysis. No tags, files, beat markers or cues are written.
/// Experimental onset-autocorrelation / chroma-profile baseline, NOT a calibrated
/// probability model or a claim of parity with commercial DJ analysers.
public sealed class MusicAnalyzer(Mp3Transcoder ffmpeg) : IMusicAnalyzer
{
    public bool IsAvailable => ffmpeg.IsAvailable;
    public async Task<MusicAnalysis> AnalyzeAsync(string path, bool bpm, bool key, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var executable = ffmpeg.FfmpegPath ?? throw new IOException("FFmpeg is unavailable. Check its path in Settings.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromMinutes(10));
        using var process = new Process { StartInfo = new(executable) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
        } };
        foreach (var arg in new[] { "-nostdin", "-v", "error", "-xerror", "-threads", "1", "-i", path,
            "-map", "0:a:0", "-vn", "-ac", "1", "-ar", MusicFeatures.SampleRate.ToString(), "-f", "f32le", "pipe:1" })
            process.StartInfo.ArgumentList.Add(arg);
        process.Start();
        // Drain concurrently to avoid a full stderr pipe deadlocking the decoder.
        var errors = DrainErrors(process.StandardError);
        try
        {
            var features = new MusicFeatures(bpm, key);
            var bytes = new byte[32768];
            var pending = 0;
            while (true)
            {
                var read = await process.StandardOutput.BaseStream.ReadAsync(bytes.AsMemory(pending), timeout.Token);
                if (read == 0) break;
                var length = read + pending;
                var complete = length - length % 4;
                for (var i = 0; i < complete; i += 4)
                {
                    if ((i & 4095) == 0) timeout.Token.ThrowIfCancellationRequested();
                    var sample = BitConverter.Int32BitsToSingle(System.Buffers.Binary.BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan(i, 4)));
                    if (!float.IsFinite(sample)) throw new IOException("The decoded audio contains invalid samples.");
                    features.Add(sample);
                }
                pending = length - complete;
                bytes.AsSpan(complete, pending).CopyTo(bytes);
            }
            await process.WaitForExitAsync(timeout.Token);
            if (process.ExitCode != 0 || pending != 0)
                throw new IOException("The audio could not be decoded. Check that it plays and is not corrupted.");
            await errors;
            return features.Finish(timeout.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        { throw new IOException("Audio analysis timed out. Try a shorter track."); }
        finally
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { /* Process exited between the check and kill. */ }
            await process.WaitForExitAsync(CancellationToken.None);
            await errors;
        }
    }
    private static async Task DrainErrors(StreamReader reader)
    {
        var buffer = new char[2048];
        while (await reader.ReadAsync(buffer) != 0) { } // constant memory, no raw file paths/tags in UI diagnostics
    }
}

/// Bounded memory: one circular PCM window, onset envelope (maximum 2 hours)
/// and aggregate pitch classes. FFT primitives come from the existing NAudio dependency.
public sealed class MusicFeatures(bool findBpm, bool findKey)
{
    public const int SampleRate = 11025;
    public const string Engine = "wisp-onset-chroma-v1";
    private const int Hop = 256, TempoFrame = 2048, KeyFrame = 8192;
    private readonly float[] ring = new float[KeyFrame];
    private readonly Complex[] tempoFft = new Complex[TempoFrame], keyFft = new Complex[KeyFrame];
    private readonly double[] previous = new double[TempoFrame / 2], chroma = new double[12];
    private readonly List<double> onsets = [];
    private long samples;
    private double energy;
    private int tonalFrames;
    private static readonly double[] Major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    private static readonly double[] Minor = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    private static readonly string[] MajorCamelot = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];
    private static readonly string[] MinorCamelot = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];

    public void Add(float sample)
    {
        if (++samples > SampleRate * 7200L) throw new IOException("Analysis supports individual tracks up to two hours long.");
        ring[(samples - 1) % KeyFrame] = sample;
        energy += sample * sample;
        if (findBpm && samples >= TempoFrame && samples % Hop == 0)
        {
            Transform(tempoFft, 11);
            double flux = 0;
            for (var k = 2; k < previous.Length; k++)
            {
                var magnitude = Math.Log(1 + 1000 * Magnitude(tempoFft[k]));
                flux += Math.Max(0, magnitude - previous[k]);
                previous[k] = magnitude;
            }
            onsets.Add(flux);
        }
        if (findKey && samples >= KeyFrame && samples % KeyFrame == 0) AddChroma();
    }

    private void Transform(Complex[] fft, int power)
    {
        for (var i = 0; i < fft.Length; i++)
        {
            var index = (samples - fft.Length + i) % KeyFrame;
            fft[i].X = (float)(ring[index] * (0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (fft.Length - 1))));
            fft[i].Y = 0;
        }
        FastFourierTransform.FFT(true, power, fft);
    }
    private static double Magnitude(Complex c) => Math.Sqrt(c.X * c.X + c.Y * c.Y);

    private void AddChroma()
    {
        Transform(keyFft, 13);
        var magnitudes = keyFft.Select(Magnitude).ToArray();
        var frame = new double[12];
        for (var k = 60; k < 2600; k++) // ~81 Hz–3.5 kHz; baseline avoids sub-bass/noise floor.
        {
            var value = magnitudes[k];
            if (value < 0.00001 || value <= magnitudes[k - 1] || value <= magnitudes[k + 1]) continue;
            // Sub-bin peak interpolation avoids quantising low notes to the wrong semitone.
            var left = Math.Log(magnitudes[k - 1] + 1e-12);
            var center = Math.Log(value + 1e-12);
            var right = Math.Log(magnitudes[k + 1] + 1e-12);
            var offset = Math.Clamp(0.5 * (left - right) / (left - 2 * center + right), -0.5, 0.5);
            var midi = 69 + 12 * Math.Log2((k + offset) * SampleRate / KeyFrame / 440);
            var note = (int)Math.Round(midi);
            var tuning = Math.Abs(midi - note);
            if (tuning > 0.35) continue;
            frame[(note % 12 + 12) % 12] += value * (1 - tuning / 0.5);
        }
        var sum = frame.Sum();
        if (sum < 0.0001) return;
        // Equal frame contribution keeps a loud passage from dominating the whole track.
        for (var i = 0; i < 12; i++) chroma[i] += frame[i] / sum;
        tonalFrames++;
    }

    public MusicAnalysis Finish(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        var seconds = (double)samples / SampleRate;
        if (seconds < 8 || energy / Math.Max(samples, 1) < 1e-9)
            throw new IOException("Not enough audible music to analyse. Use a track with at least eight seconds of audio.");
        var tempo = findBpm ? Tempo(ct) : (null, 0d, true);
        var key = findKey ? Key() : (null, 0d, true);
        return new(tempo.Item1, key.Item1, tempo.Item2, key.Item2, tempo.Item3, key.Item3, seconds, Engine);
    }

    private (decimal?, double, bool) Tempo(CancellationToken ct)
    {
        var rate = (double)SampleRate / Hop;
        var window = (int)(rate * 30);
        var votes = new List<(double Bpm, double Strength)>();
        for (var start = 0; start < onsets.Count; start += window)
        {
            ct.ThrowIfCancellationRequested();
            var length = Math.Min(window, onsets.Count - start);
            if (length < rate * 8) continue;
            var data = onsets.Skip(start).Take(length).ToArray();
            // Remove local baseline rather than letting a noisy constant spectrum vote for a tempo.
            var mean = data.Average();
            for (var i = 0; i < length; i++) data[i] = Math.Max(0, data[i] - mean);
            var scores = new double[(int)(rate * 60 / 55) + 2];
            for (var lag = (int)(rate * 60 / 210); lag < scores.Length; lag++)
            {
                double product = 0, a = 0, b = 0;
                for (var i = lag; i < length; i++)
                { product += data[i] * data[i - lag]; a += data[i] * data[i]; b += data[i - lag] * data[i - lag]; }
                scores[lag] = product / (Math.Sqrt(a * b) + 1e-12);
            }
            var candidates = Enumerable.Range((int)(rate * 60 / 210) + 1, scores.Length - (int)(rate * 60 / 210) - 2)
                .Where(l => scores[l] >= scores[l - 1] && scores[l] > scores[l + 1]).ToArray();
            if (candidates.Length == 0) continue;
            // A deliberately disclosed dance-music prior resolves octave ambiguity.
            // Review offers half/double tempo; this is NOT downbeat/beatgrid detection.
            var best = candidates.MaxBy(l => scores[l] * (60 * rate / l is >= 90 and <= 160 ? 1.15 : 1));
            var delta = Math.Clamp(0.5 * (scores[best - 1] - scores[best + 1]) /
                (scores[best - 1] - 2 * scores[best] + scores[best + 1] - 1e-12), -0.5, 0.5);
            votes.Add((60 * rate / (best + delta), scores[best]));
        }
        var good = votes.Where(v => v.Strength > 0.1).OrderBy(v => v.Bpm).ToArray();
        if (good.Length == 0) return (null, 0, true);
        // Express octave-equivalent section estimates in a consistent dance range.
        // Explicitly flag the adjustment; slower/faster genres need manual review.
        var median = good[good.Length / 2].Bpm;
        var consistent = good.Where(v => Math.Abs(v.Bpm - median) < 2).ToArray();
        var rawBpm = consistent.Average(v => v.Bpm);
        var bpm = rawBpm < 90 ? rawBpm * 2 : rawBpm > 180 ? rawBpm / 2 : rawBpm;
        var strength = consistent.Average(v => v.Strength);
        var refined = RefineTempo(bpm, rate, ct);
        if (refined.Coherence > 0.08) bpm = refined.Bpm;
        return (Math.Round((decimal)bpm, 2), strength, refined.Coherence <= 0.08 || strength < 0.45 ||
            consistent.Length < good.Length * 0.8 || good.Any(v => v.Bpm < 90 || v.Bpm > 180));
    }

    private (double Bpm, double Coherence) RefineTempo(double estimate, double rate, CancellationToken ct)
    {
        // Autocorrelation's short lag is quantised to ~23 ms. Refine near that
        // candidate using whole-track phase coherence, rather than pretending
        // interpolated lag alone gives hundredth-BPM precision. No grid is saved.
        var mean = onsets.Average();
        var weights = onsets.Select(v => Math.Max(0, v - mean)).ToArray();
        var sum = weights.Sum();
        var best = estimate; double bestPower = 0;
        for (var step = -100; step <= 100; step++)
        {
            ct.ThrowIfCancellationRequested();
            var trial = estimate + step * 0.01;
            var angle = 2 * Math.PI * trial / 60 / rate;
            var cosineStep = Math.Cos(angle); var sineStep = Math.Sin(angle);
            double cosine = 1, sine = 0, real = 0, imaginary = 0;
            foreach (var weight in weights)
            {
                real += weight * cosine; imaginary += weight * sine;
                var next = cosine * cosineStep - sine * sineStep;
                sine = sine * cosineStep + cosine * sineStep; cosine = next;
            }
            var power = real * real + imaginary * imaginary;
            if (power > bestPower) { bestPower = power; best = trial; }
        }
        return (best, Math.Sqrt(bestPower) / (sum + 1e-12));
    }

    private (string?, double, bool) Key()
    {
        if (tonalFrames < 4) return (null, 0, true);
        var candidates = new List<(string Key, double Score)>();
        for (var root = 0; root < 12; root++)
        {
            candidates.Add((MajorCamelot[root], Correlation(chroma, Major, root)));
            candidates.Add((MinorCamelot[root], Correlation(chroma, Minor, root)));
        }
        var sorted = candidates.OrderByDescending(c => c.Score).ToArray();
        var best = sorted[0];
        if (best.Score < 0.3) return (null, best.Score, true);
        // Current real-music comparisons do not justify automatic key acceptance,
        // even when profile correlation is strong. ALL keys require explicit review.
        return (best.Key, best.Score, true);
    }
    private static double Correlation(double[] values, double[] profile, int root)
    {
        var aMean = values.Average(); var bMean = profile.Average();
        double product = 0, aPower = 0, bPower = 0;
        for (var i = 0; i < 12; i++)
        {
            var a = values[(i + root) % 12] - aMean; var b = profile[i] - bMean;
            product += a * b; aPower += a * a; bPower += b * b;
        }
        return product / (Math.Sqrt(aPower * bPower) + 1e-12);
    }
}
