namespace Wisp.Core.Cues;

public sealed record PhraseMarker(int BeatNumber, double TimeSeconds, string Label);

/// Generate beat-aligned phrase markers from a known first beat + BPM.
/// Emits one marker per `stepBeats` (default 16 — the standard sub-phrase boundary).
/// 32- and 64-beat markers fall out naturally as multiples and are flagged in the label.
public static class PhraseMarkers
{
    public static IEnumerable<PhraseMarker> Generate(
        double firstBeatSec,
        decimal bpm,
        double trackDurationSec,
        int stepBeats = 16)
    {
        if (bpm <= 0 || stepBeats <= 0) yield break;
        var secondsPerBeat = 60.0 / (double)bpm;

        for (var n = stepBeats; ; n += stepBeats)
        {
            var t = firstBeatSec + n * secondsPerBeat;
            if (trackDurationSec > 0 && t > trackDurationSec) break;

            var label = n switch
            {
                _ when n % 64 == 0 => $"{n} beats · phrase",
                _ when n % 32 == 0 => $"{n} beats",
                _ => $"{n} beats",
            };
            yield return new PhraseMarker(n, t, label);
        }
    }
}
