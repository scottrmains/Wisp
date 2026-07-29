using Wisp.Core.Tracks;

namespace Wisp.Core.Cues;

/// <summary>
/// A cue deliberately approved for export to a DJ player. This is separate from
/// Wisp's editorial markers: a phrase marker or an automatically detected drop
/// must never silently become performance data on a USB.
/// </summary>
public class DeviceCue
{
    public Guid Id { get; set; }
    public Guid TrackId { get; set; }
    public DeviceCueKind Kind { get; set; } = DeviceCueKind.MemoryCue;
    public double StartSeconds { get; set; }
    public double? EndSeconds { get; set; }
    public string? Comment { get; set; }
    public Guid? SourceCuePointId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public Track? Track { get; set; }
    public CuePoint? SourceCuePoint { get; set; }
}

public enum DeviceCueKind
{
    MemoryCue = 1,
    Loop = 2,
}
