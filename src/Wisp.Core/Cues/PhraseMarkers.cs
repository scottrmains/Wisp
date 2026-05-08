namespace Wisp.Core.Cues;

public sealed record PhraseMarker(int BeatNumber, double TimeSeconds, string Label);

/// Generate beat-aligned phrase markers from a known first beat + BPM.
/// Emits one marker per `stepBeats` (default 64 — a full 16-bar phrase, the
/// "logical" boundary the user actually mixes around in dance music).
/// Smaller subdivisions (16/32) are still available via the parameter for users
/// who want a denser grid for nudging.
public static class PhraseMarkers
{
    public static IEnumerable<PhraseMarker> Generate(
        double firstBeatSec,
        decimal bpm,
        double trackDurationSec,
        int stepBeats = 64)
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
