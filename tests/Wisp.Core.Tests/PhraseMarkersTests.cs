using Wisp.Core.Cues;

namespace Wisp.Core.Tests;

public class PhraseMarkersTests
{
    [Fact]
    public void Spec_example_at_126_bpm_matches_to_within_1ms()
    {
        // From spec §8: 1 beat = 0.476s; 32 beats = 15.23s; 64 beats = 30.47s.
        // Use stepBeats: 16 here so beats 32 and 64 are both emitted independent
        // of the default phrase step (now 64).
        var markers = PhraseMarkers.Generate(0, 126m, 60, stepBeats: 16).ToList();

        var beat32 = markers.First(m => m.BeatNumber == 32);
        Assert.InRange(beat32.TimeSeconds, 15.237, 15.239);

        var beat64 = markers.First(m => m.BeatNumber == 64);
        Assert.InRange(beat64.TimeSeconds, 30.475, 30.477);
    }

    [Fact]
    public void Offsets_from_first_beat_position()
    {
        // First beat at 0.5s, 120 BPM = 0.5s/beat. Beat 16 = 0.5 + 8 = 8.5s.
        var markers = PhraseMarkers.Generate(firstBeatSec: 0.5, bpm: 120m, trackDurationSec: 60, stepBeats: 16).ToList();
        Assert.Equal(8.5, markers.First(m => m.BeatNumber == 16).TimeSeconds, precision: 6);
    }

    [Fact]
    public void Stops_before_track_end()
    {
        // 4-second track at 120 BPM (0.5s/beat) — 16 beats = 8s, past the end. Nothing emitted.
        var markers = PhraseMarkers.Generate(0, 120m, 4).ToList();
        Assert.Empty(markers);
    }

    [Fact]
    public void Step_size_can_be_customised()
    {
        var markers = PhraseMarkers.Generate(0, 120m, 60, stepBeats: 32).ToList();
        Assert.All(markers, m => Assert.Equal(0, m.BeatNumber % 32));
        Assert.DoesNotContain(markers, m => m.BeatNumber == 16);
    }

    [Fact]
    public void Phrase_label_marks_64_beat_boundaries()
    {
        var markers = PhraseMarkers.Generate(0, 120m, 60).ToList();
        Assert.Contains("phrase", markers.First(m => m.BeatNumber == 64).Label, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-120)]
    public void Zero_or_negative_bpm_yields_nothing(int bpm)
    {
        Assert.Empty(PhraseMarkers.Generate(0, bpm, 60));
    }
}
