namespace Wisp.Core.Recordings;

/// Audio belongs to this recording, never to a library Track or its cue identity.
public sealed class RecordingSession
{
    public Guid Id { get; set; }
    public string Title { get; set; } = "";
    public string DirectoryPath { get; set; } = "";
    public string EndpointId { get; set; } = "";
    public string DeviceName { get; set; } = "";
    public int SampleRate { get; set; }
    public DateTime StartedAt { get; set; }
    public string State { get; set; } = "Preparing";
    public long AudioBytes { get; set; }
    public string? Issue { get; set; }
    public Guid? PreviousTakeId { get; set; }
    public bool Hidden { get; set; }
    public string? RelinkedPath { get; set; }
    public string? AudioHash { get; set; }
}
