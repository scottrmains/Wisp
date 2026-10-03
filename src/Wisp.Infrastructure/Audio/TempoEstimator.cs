namespace Wisp.Infrastructure.Audio;

/// Multiband rhythm agreement, not a beatgrid or a calibrated probability model.
/// Bass and full-spectrum onsets are normalised independently so bright hats do
/// not drown out the kick. Sections vote before whole-track phase refinement.
internal static class TempoEstimator
{
    private const double Rate = (double)MusicFeatures.SampleRate / 256;

    public static (decimal?, double, bool) Analyze(IReadOnlyList<double> full, IReadOnlyList<double> bass, CancellationToken ct)
    {
        var window = (int)(Rate * 30);
        var votes = new List<(double Bpm, double Strength, bool Folded)>();
        for (var start = 0; start < full.Count; start += window)
        {
            ct.ThrowIfCancellationRequested();
            var length = Math.Min(window, full.Count - start);
            if (length < Rate * 8) continue;
            var a = Envelope(full, start, length);
            var b = Envelope(bass, start, length);
            var aScores = Correlations(a, ct);
            var bScores = Correlations(b, ct);
            var bassWeight = bScores.Max() > 0.2 ? 0.65 : 0;
            var scores = aScores.Select((value, i) => (1 - bassWeight) * value + bassWeight * bScores[i]).ToArray();
            var candidates = Enumerable.Range(1, scores.Length - 2)
                .Where(l => scores[l] >= scores[l - 1] && scores[l] > scores[l + 1] && scores[l] > 0.15).ToArray();
            if (candidates.Length == 0) continue;
            var best = candidates.MaxBy(l => scores[l] * (60 * Rate / l is >= 90 and <= 180 ? 1.08 : 1));
            var delta = Math.Clamp(0.5 * (scores[best - 1] - scores[best + 1]) /
                (scores[best - 1] - 2 * scores[best] + scores[best + 1] - 1e-12), -0.5, 0.5);
            var raw = 60 * Rate / (best + delta);
            var bpm = raw < 90 ? raw * 2 : raw > 180 ? raw / 2 : raw;
            votes.Add((bpm, scores[best], raw != bpm));
        }
        if (votes.Count == 0) return (null, 0, true);
        // Weighted modal cluster, not the median of incompatible rhythmic subdivisions.
        var center = votes.MaxBy(v => votes.Where(w => Math.Abs(w.Bpm - v.Bpm) < 2).Sum(w => w.Strength)).Bpm;
        var consistent = votes.Where(v => Math.Abs(v.Bpm - center) < 2).ToArray();
        var estimate = consistent.Sum(v => v.Bpm * v.Strength) / consistent.Sum(v => v.Strength);
        var fullWeights = Envelope(full, 0, full.Count);
        var bassWeights = Envelope(bass, 0, bass.Count);
        var bassSum = bassWeights.Sum();
        var fullSum = fullWeights.Sum();
        var bassRefine = bassSum > 1e-12 ? 0.65 : 0;
        double bestBpm = estimate, bestCoherence = 0;
        for (var step = -100; step <= 100; step++)
        {
            ct.ThrowIfCancellationRequested();
            var trial = estimate + step * 0.01;
            var coherence = (1 - bassRefine) * Coherence(fullWeights, fullSum, trial) +
                bassRefine * Coherence(bassWeights, bassSum, trial);
            if (coherence > bestCoherence) { bestCoherence = coherence; bestBpm = trial; }
        }
        var strength = consistent.Average(v => v.Strength);
        return (Math.Round((decimal)(bestCoherence > 0.08 ? bestBpm : estimate), 2), strength,
            bestCoherence <= 0.08 || strength < 0.45 || consistent.Length < votes.Count * 0.8 || consistent.Any(v => v.Folded));
    }

    private static double[] Envelope(IReadOnlyList<double> source, int start, int length)
    {
        var result = new double[length];
        double sum = 0;
        for (var i = 0; i < length; i++) sum += source[start + i];
        var mean = sum / Math.Max(length, 1);
        for (var i = 0; i < length; i++) result[i] = Math.Max(0, source[start + i] - mean);
        return result;
    }

    private static double[] Correlations(double[] data, CancellationToken ct)
    {
        var scores = new double[(int)(Rate * 60 / 55) + 2];
        for (var lag = (int)(Rate * 60 / 210); lag < scores.Length; lag++)
        {
            ct.ThrowIfCancellationRequested();
            double product = 0, a = 0, b = 0;
            for (var i = lag; i < data.Length; i++)
            { product += data[i] * data[i - lag]; a += data[i] * data[i]; b += data[i - lag] * data[i - lag]; }
            scores[lag] = product / (Math.Sqrt(a * b) + 1e-12);
        }
        return scores;
    }

    private static double Coherence(double[] weights, double sum, double bpm)
    {
        var angle = 2 * Math.PI * bpm / 60 / Rate;
        var cosineStep = Math.Cos(angle); var sineStep = Math.Sin(angle);
        double cosine = 1, sine = 0, real = 0, imaginary = 0;
        foreach (var weight in weights)
        {
            real += weight * cosine; imaginary += weight * sine;
            var next = cosine * cosineStep - sine * sineStep;
            sine = sine * cosineStep + cosine * sineStep; cosine = next;
        }
        return Math.Sqrt(real * real + imaginary * imaginary) / (sum + 1e-12);
    }
}
