namespace Wisp.Core.Recordings;

// Separate from capture's mutable session so saving a checkpoint cannot overwrite review edits.
public sealed class RecordingReview
{
    public Guid Id { get; set; }
    public int? Rating { get; set; }
    public string MarkersJson { get; set; } = "[]";
    public int Revision { get; set; }
    public string? SourceHash { get; set; }
}
