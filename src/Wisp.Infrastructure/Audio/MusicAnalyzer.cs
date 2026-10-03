using System.Diagnostics;
using NAudio.Dsp;

namespace Wisp.Infrastructure.Audio;

public sealed record MusicAnalysis(decimal? Bpm, string? Key, double TempoStrength, double KeyStrength,
    bool TempoUncertain, bool KeyUncertain, double Seconds, string Engine, string? DecodeWarning = null,
    double? KeyAgreement = null, double? TuningCents = null, string? AlternativeKey = null, string? KeyWarning = null);

public interface IMusicAnalyzer
{
    bool IsAvailable { get; }
    Task<MusicAnalysis> AnalyzeAsync(string path, bool bpm, bool key, CancellationToken ct);
}

/// Read-only, streaming PCM analysis. No tags, files, beat markers or cues are written.
/// Experimental multiband rhythm / tuning-aware tonal analysis, NOT a calibrated
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
        // Recover isolated bad packets. Also apply our own bounded packet-error guard below:
        // the bundled FFmpeg does not consistently enforce max_error_rate for audio packets.
        // -xerror aborts even on one recoverable packet at the end of an otherwise usable track.
        foreach (var arg in new[] { "-nostdin", "-v", "repeat+error", "-max_error_rate", "0.01", "-threads", "1", "-i", path,
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
            var diagnostics = await errors;
            if (diagnostics.PacketErrors > MaxRecoverablePacketErrors)
                throw new IOException("The audio has too many decoding errors to analyse reliably. Try another copy of the track.");
            var result = features.Finish(timeout.Token);
            return diagnostics.HasWarnings ? result with {
                TempoUncertain = bpm || result.TempoUncertain,
                KeyUncertain = key || result.KeyUncertain,
                DecodeWarning = "Decoded with recoverable file warnings. Listen to the track and check these suggestions before applying them. The original file has not been changed.",
            } : result;
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
    private const int MaxRecoverablePacketErrors = 8;
    private sealed record DecodeDiagnostics(bool HasWarnings, int PacketErrors);
    private static async Task<DecodeDiagnostics> DrainErrors(StreamReader reader)
    {
        var buffer = new char[2048];
        var line = new System.Text.StringBuilder(1024);
        var hasWarnings = false;
        var packetErrors = 0;
        void CountLine()
        {
            var text = line.ToString();
            // Count packet-level diagnostics once; codec details often accompany the same failure.
            if (text.Contains("Error submitting packet to decoder", StringComparison.OrdinalIgnoreCase) ||
                text.Contains("Error decoding a frame", StringComparison.OrdinalIgnoreCase))
                packetErrors = Math.Min(packetErrors + 1, MaxRecoverablePacketErrors + 1);
            line.Clear();
        }
        int read;
        while ((read = await reader.ReadAsync(buffer)) != 0)
        {
            hasWarnings = true;
            for (var i = 0; i < read; i++)
                if (buffer[i] is '\r' or '\n') CountLine();
                else if (line.Length < 1024) line.Append(buffer[i]);
        }
        CountLine();
        return new(hasWarnings, packetErrors); // bounded memory, no raw file paths/tags in UI diagnostics
    }
}

/// Bounded memory: one circular PCM window, onset envelope (maximum 2 hours)
/// and aggregate pitch classes. FFT primitives come from the existing NAudio dependency.
public sealed class MusicFeatures(bool findBpm, bool findKey)
{
    public const int SampleRate = 11025;
    public const string Engine = "wisp-multiband-tonal-v2";
    private const int Hop = 256, TempoFrame = 2048, KeyFrame = 8192;
    private readonly float[] ring = new float[KeyFrame];
    private readonly Complex[] tempoFft = new Complex[TempoFrame], keyFft = new Complex[KeyFrame];
    private readonly double[] previous = new double[TempoFrame / 2];
    private readonly List<double> onsets = [], bassOnsets = [];
    private readonly KeyEstimator? keyEstimator = findKey ? new() : null;
    private long samples;
    private double energy;

    public void Add(float sample)
    {
        if (++samples > SampleRate * 7200L) throw new IOException("Analysis supports individual tracks up to two hours long.");
        ring[(samples - 1) % KeyFrame] = sample;
        energy += sample * sample;
        if (findBpm && samples >= TempoFrame && samples % Hop == 0)
        {
            Transform(tempoFft, 11);
            double flux = 0, bassFlux = 0;
            for (var k = 2; k < previous.Length; k++)
            {
                var magnitude = Math.Log(1 + 1000 * Magnitude(tempoFft[k]));
                var change = Math.Max(0, magnitude - previous[k]);
                flux += change;
                if (k * (double)SampleRate / TempoFrame is >= 35 and <= 180) bassFlux += change;
                previous[k] = magnitude;
            }
            onsets.Add(flux);
            bassOnsets.Add(bassFlux);
        }
        if (findKey && samples >= KeyFrame && samples % KeyFrame == 0)
        {
            Transform(keyFft, 13);
            keyEstimator!.AddSpectrum(keyFft, samples);
        }
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


    public MusicAnalysis Finish(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        var seconds = (double)samples / SampleRate;
        if (seconds < 8 || energy / Math.Max(samples, 1) < 1e-9)
            throw new IOException("Not enough audible music to analyse. Use a track with at least eight seconds of audio.");
        var tempo = findBpm ? TempoEstimator.Analyze(onsets, bassOnsets, ct) : (null, 0d, true);
        var key = keyEstimator?.Finish(ct);
        return new(tempo.Item1, key?.Key, tempo.Item2, key?.Strength ?? 0, tempo.Item3, true, seconds, Engine,
            KeyAgreement: key?.Agreement, TuningCents: key?.TuningCents, AlternativeKey: key?.Alternative, KeyWarning: key?.Warning);
    }
}
