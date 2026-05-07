using Wisp.Core.Tracks;

namespace Wisp.Core.Cues;

public enum CuePointType
{
    FirstBeat,
    Intro,
    MixIn,
    Breakdown,
    Drop,
    VocalIn,
    MixOut,
    Outro,
    Custom,
}

public class CuePoint
{
    public Guid Id { get; set; }
    public Guid TrackId { get; set; }

    public double TimeSeconds { get; set; }
    public string Label { get; set; } = "";
    public CuePointType Type { get; set; }
    public bool IsAutoSuggested { get; set; }

    public DateTime CreatedAt { get; set; }

    public Track? Track { get; set; }
}
