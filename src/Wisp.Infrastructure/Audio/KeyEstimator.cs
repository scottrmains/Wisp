using NAudio.Dsp;

namespace Wisp.Infrastructure.Audio;

/// Independent peak/tuning diagnostic. The published spectral detector supplies
/// the primary suggestion; this view only warns about disagreement and reports tuning.
/// Uses no external tags, proprietary analyser, trained model or third-party DSP code.
internal sealed class KeyEstimator
{
    private const int Resolution = 6, FirstMidi = 24, LastMidi = 112, Notes = 72;
    private const int Bins = (LastMidi - FirstMidi) * Resolution;
    private readonly SortedDictionary<int, Section> sections = [];
    private readonly double[] referenceChroma = new double[12];
    private int referenceFrames;
    private double tuningReal, tuningImaginary, tuningWeight;
    private sealed class Section { public double[] Spectrum = new double[Bins]; public int Frames; }
    private static readonly double[] Major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    private static readonly double[] Minor = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    private static readonly string[] MajorCamelot = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];
    private static readonly string[] MinorCamelot = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];

    public void AddSpectrum(Complex[] fft, long sampleCount)
    {
        var magnitudes = new double[fft.Length / 2];
        double energy = 0;
        for (var k = 1; k < magnitudes.Length; k++)
        {
            magnitudes[k] = Math.Sqrt(fft[k].X * fft[k].X + fft[k].Y * fft[k].Y);
            energy += magnitudes[k] * magnitudes[k];
        }
        var peaks = new List<(double Midi, double Magnitude)>();
        double peakEnergy = 0;
        for (var k = 2; k < magnitudes.Length - 1; k++)
        {
            var value = magnitudes[k];
            if (k < 60 || k >= 2600 || value < 0.00001 || value <= magnitudes[k - 1] || value <= magnitudes[k + 1]) continue;
            var left = Math.Log(magnitudes[k - 1] + 1e-12);
            var center = Math.Log(value + 1e-12);
            var right = Math.Log(magnitudes[k + 1] + 1e-12);
            var offset = Math.Clamp(0.5 * (left - right) / (left - 2 * center + right), -0.5, 0.5);
            var midi = 69 + 12 * Math.Log2((k + offset) * MusicFeatures.SampleRate / fft.Length / 440);
            peaks.Add((midi, value)); peakEnergy += value * value;
        }
        // Retain the previous baseline within this independent diagnostic view.
        // It does not overrule the production spectral detector.
        var referenceFrame = new double[12];
        foreach (var peak in peaks)
        {
            var note = (int)Math.Round(peak.Midi);
            var deviation = Math.Abs(peak.Midi - note);
            if (deviation <= 0.35) referenceFrame[(note % 12 + 12) % 12] += peak.Magnitude * (1 - deviation / 0.5);
        }
        var referenceSum = referenceFrame.Sum();
        if (referenceSum >= 0.0001)
        {
            for (var i = 0; i < 12; i++) referenceChroma[i] += referenceFrame[i] / referenceSum;
            referenceFrames++;
        }
        // Ignore broad-spectrum/noisy frames rather than giving every drum hit a key vote.
        if (peaks.Count == 0 || peakEnergy / (energy + 1e-12) < 0.15) return;
        var selected = peaks.ToArray();
        var sum = selected.Sum(p => p.Magnitude);
        var index = (int)(sampleCount / (MusicFeatures.SampleRate * 30L));
        if (!sections.TryGetValue(index, out var section)) sections[index] = section = new();
        foreach (var peak in selected)
        {
            var weight = peak.Magnitude / sum;
            Deposit(section.Spectrum, (peak.Midi - FirstMidi) * Resolution, weight);
            var deviation = peak.Midi - Math.Round(peak.Midi);
            tuningReal += weight * Math.Cos(2 * Math.PI * deviation);
            tuningImaginary += weight * Math.Sin(2 * Math.PI * deviation);
            tuningWeight += weight;
        }
        section.Frames++;
    }

    public (string? Key, double Strength, bool Uncertain, double Agreement, double TuningCents, string? Alternative, string? Warning) Finish(CancellationToken ct)
    {
        var tuningCoherence = Math.Sqrt(tuningReal * tuningReal + tuningImaginary * tuningImaginary) / (tuningWeight + 1e-12);
        var tuning = tuningCoherence > 0.15 ? Math.Atan2(tuningImaginary, tuningReal) / (2 * Math.PI) : 0;
        var tonalSections = new List<(int Frames, int Best)>();
        var total = new double[12];
        foreach (var section in sections.Values)
        {
            ct.ThrowIfCancellationRequested();
            if (section.Frames < 4) continue;
            var shifted = new double[Bins];
            for (var bin = 0; bin < Bins; bin++) shifted[bin] = Interpolate(section.Spectrum, bin + tuning * Resolution) / section.Frames;
            var chroma = new double[12];
            for (var note = 0; note < Notes; note++)
                for (var bin = -2; bin <= 2; bin++)
                    chroma[(FirstMidi + note) % 12] += Interpolate(shifted, note * Resolution + bin) * (3 - Math.Abs(bin)) / 3d;
            var sum = chroma.Sum();
            if (sum < 1e-9 || chroma.Count(v => v > chroma.Max() * 0.15) < 3) continue;
            for (var i = 0; i < 12; i++) { chroma[i] /= sum; total[i] += chroma[i] * section.Frames; }
            var sectionScores = Scores(chroma);
            tonalSections.Add((section.Frames, Enumerable.Range(0, 24).MaxBy(i => sectionScores[i])));
        }
        if (tonalSections.Count == 0) return (null, 0, true, 0, tuning * 100, null, "Not enough stable tonal content to suggest a key.");
        var global = Scores(total);
        var votes = new double[24];
        var frames = tonalSections.Sum(s => s.Frames);
        foreach (var section in tonalSections) votes[section.Best] += (double)section.Frames / frames;
        // Section disagreement informs review, not a bias towards the most repeated chord.
        var ranking = Enumerable.Range(0, 24).OrderByDescending(i => global[i]).ToArray();
        var sectionBest = ranking[0];
        var best = sectionBest;
        if (referenceFrames >= 4 && referenceChroma.Count(v => v > referenceChroma.Max() * 0.15) >= 3)
        {
            var referenceScores = Scores(referenceChroma);
            var referenceBest = Enumerable.Range(0, 24).MaxBy(i => referenceScores[i]);
            if (referenceScores[referenceBest] >= 0.3) { best = referenceBest; global = referenceScores; }
        }
        var second = ranking.First(i => i != best);
        if (global[best] < 0.3) return (null, global[best], true, votes[best], tuning * 100, null, "No clear key match. Review by ear.");
        var warning = best != sectionBest ? "Whole-song and tuning-corrected section estimates disagree. Audition the alternatives before applying." :
            votes[best] < 0.65 ? "Tonal sections disagree. This may be an ambiguous or changing key; audition before applying." :
            global[best] - global[second] < 0.08 ? "Two key interpretations are close. Audition the alternatives before applying." : null;
        return (Code(best), global[best], true, Math.Clamp(votes[best], 0, 1), tuning * 100, Code(second), warning);
    }
    private static void Deposit(double[] bins, double position, double weight)
    {
        var lower = (int)Math.Floor(position); var fraction = position - lower;
        if (lower >= 0 && lower < bins.Length) bins[lower] += weight * (1 - fraction);
        if (lower + 1 >= 0 && lower + 1 < bins.Length) bins[lower + 1] += weight * fraction;
    }
    private static double Interpolate(double[] bins, double position)
    {
        var lower = (int)Math.Floor(position); var fraction = position - lower;
        return (lower >= 0 && lower < bins.Length ? bins[lower] * (1 - fraction) : 0) +
            (lower + 1 >= 0 && lower + 1 < bins.Length ? bins[lower + 1] * fraction : 0);
    }
    private static string Code(int candidate) => candidate < 12 ? MajorCamelot[candidate] : MinorCamelot[candidate - 12];
    private static double[] Scores(double[] chroma) => Enumerable.Range(0, 24).Select(i => Correlation(chroma, i < 12 ? Major : Minor, i % 12)).ToArray();
    private static double Correlation(double[] chroma, double[] profile, int root)
    {
        var mean = chroma.Average(); var profileMean = profile.Average();
        double product = 0, a = 0, b = 0;
        for (var i = 0; i < 12; i++)
        {
            var x = chroma[(i + root) % 12] - mean; var y = profile[i] - profileMean;
            product += x * y; a += x * x; b += y * y;
        }
        return product / (Math.Sqrt(a * b) + 1e-12);
    }
}
