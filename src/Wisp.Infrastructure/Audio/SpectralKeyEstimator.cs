using NAudio.Dsp;

namespace Wisp.Infrastructure.Audio;

/// Independent implementation of the direct spectral kernel equations (2.4–2.8)
/// in Ibrahim Sha'ath's KeyFinder report, with published Sha'ath tone profiles.
/// No KeyFinder/Essentia source or trained checkpoint is incorporated.
/// WISP adds square-root compression and frame normalisation, selected on a
/// separate development sample. Cosine similarity is NOT a correctness probability.
internal sealed class SpectralKeyEstimator
{
    private const int Frame = 65536, Hop = Frame / 4;
    private readonly float[] ring = new float[Frame];
    private readonly Complex[] fft = new Complex[Frame];
    private readonly double[] magnitudes = new double[Frame / 2];
    private readonly double[] total = new double[12];
    private readonly SortedDictionary<int, Section> sections = [];
    private long samples, lastFrame;
    private int frames;
    private sealed class Section { public readonly double[] Chroma = new double[12]; public int Frames; }
    private sealed record Kernel(int Start, double[] Weights);
    private static readonly double[] Window = Enumerable.Range(0, Frame)
        .Select(i => 0.42 - 0.5 * Math.Cos(2 * Math.PI * i / Frame) + 0.08 * Math.Cos(4 * Math.PI * i / Frame)).ToArray();
    private static readonly Kernel[] Kernels = BuildKernels();
    // Empirical profile parameters published by Sha'ath, Fig. 2.8 (2011),
    // independently predating the GiantSteps dataset. C through B in each mode.
    private static readonly double[] Major = [6.6, 2.0, 3.5, 2.3, 4.6, 4.0, 2.5, 5.2, 2.4, 3.7, 2.3, 3.4];
    private static readonly double[] Minor = [6.5, 2.7, 3.5, 5.4, 2.6, 3.5, 2.5, 5.2, 4.0, 2.7, 4.3, 3.2];
    private static readonly string[] Codes = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B",
        "5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];

    public void Add(float sample)
    {
        ring[samples++ % Frame] = sample;
        if (samples >= Frame && (samples - Frame) % Hop == 0) AddFrame();
    }

    private void AddFrame()
    {
        for (var i = 0; i < Frame; i++)
        {
            fft[i].X = (float)(ring[(samples - Frame + i) % Frame] * Window[i]);
            fft[i].Y = 0;
        }
        FastFourierTransform.FFT(true, 16, fft);
        for (var i = 0; i < magnitudes.Length; i++)
            magnitudes[i] = Math.Sqrt((double)fft[i].X * fft[i].X + (double)fft[i].Y * fft[i].Y);
        var chroma = new double[12];
        for (var note = 0; note < Kernels.Length; note++)
        {
            var kernel = Kernels[note];
            double value = 0;
            for (var bin = 0; bin < kernel.Weights.Length; bin++) value += magnitudes[kernel.Start + bin] * kernel.Weights[bin];
            // Compress BEFORE folding octaves: quiet harmonic notes aren't drowned
            // by a loud bass/drum, without globally favouring either major or minor.
            chroma[note % 12] += Math.Sqrt(Math.Max(0, value));
        }
        var sum = chroma.Sum();
        lastFrame = samples;
        if (sum < 1e-7) return;
        var sectionId = (int)((samples - Frame / 2) / (30L * MusicFeatures.SampleRate));
        if (!sections.TryGetValue(sectionId, out var section)) sections[sectionId] = section = new();
        for (var i = 0; i < 12; i++) { var value = chroma[i] / sum; total[i] += value; section.Chroma[i] += value; }
        section.Frames++; frames++;
    }

    public (string? Key, double Strength, double Agreement, string? Alternative, string? Warning) Finish(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        // Include the final samples too, not just an arbitrary front/middle excerpt.
        if (samples >= Frame && samples != lastFrame) AddFrame();
        if (frames < 2 || !HasTonalContrast(total))
            return (null, 0, 0, null, "Not enough distinct tonal content to suggest a key.");
        var scores = Scores(total);
        var ranking = Enumerable.Range(0, 24).OrderByDescending(i => scores[i]).ToArray();
        var best = ranking[0]; var second = ranking[1];
        double agreementFrames = 0, tonalFrames = 0;
        foreach (var section in sections.Values)
        {
            ct.ThrowIfCancellationRequested();
            if (section.Frames < 2 || !HasTonalContrast(section.Chroma)) continue;
            var sectionScores = Scores(section.Chroma);
            var sectionBest = Enumerable.Range(0, 24).MaxBy(i => sectionScores[i]);
            tonalFrames += section.Frames;
            if (sectionBest == best) agreementFrames += section.Frames;
        }
        var agreement = tonalFrames > 0 ? agreementFrames / tonalFrames : 0;
        var warning = agreement < 0.65 ? "Tonal sections disagree. This may be an ambiguous or changing key; audition before applying." :
            scores[best] - scores[second] < 0.015 ? "Two key interpretations are close. Audition the alternatives before applying." : null;
        return (Codes[best], scores[best], agreement, Codes[second], warning);
    }

    private static bool HasTonalContrast(double[] chroma) => chroma.Count(v => v > chroma.Max() * 0.15) >= 3 &&
        Math.Sqrt(chroma.Sum(v => Math.Pow(v - chroma.Average(), 2)) / 12) / (chroma.Average() + 1e-12) >= 0.04;

    private static double[] Scores(double[] chroma)
    {
        var scores = new double[24];
        var norm = Math.Sqrt(chroma.Sum(v => v * v));
        for (var candidate = 0; candidate < 24; candidate++)
        {
            var profile = candidate < 12 ? Major : Minor;
            var root = candidate % 12;
            double product = 0;
            for (var note = 0; note < 12; note++) product += chroma[(root + note) % 12] * profile[note];
            scores[candidate] = Math.Clamp(product / (norm * Math.Sqrt(profile.Sum(v => v * v)) + 1e-12), 0, 1);
        }
        return scores;
    }

    private static Kernel[] BuildKernels()
    {
        var q = 0.8 * (Math.Pow(2, 1d / 12) - 1);
        return Enumerable.Range(24, 72).Select(midi =>
        {
            var frequency = 440 * Math.Pow(2, (midi - 69) / 12d);
            var center = frequency * Frame / MusicFeatures.SampleRate;
            var lower = center * (1 - q / 2); var upper = center * (1 + q / 2);
            var start = (int)Math.Ceiling(lower); var end = (int)Math.Floor(upper);
            var weights = Enumerable.Range(start, end - start + 1)
                .Select(bin => 1 - Math.Cos(2 * Math.PI * (bin - lower) / (upper - lower))).ToArray();
            var sum = weights.Sum();
            for (var i = 0; i < weights.Length; i++) weights[i] *= frequency / ((start + i) * sum);
            return new Kernel(start, weights);
        }).ToArray();
    }
}
