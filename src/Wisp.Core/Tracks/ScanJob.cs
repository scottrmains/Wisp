namespace Wisp.Core.Tracks;

public enum ScanStatus
{
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled
}

public class ScanJob
{
    public Guid Id { get; set; }
    public string FolderPath { get; set; } = "";
    public ScanStatus Status { get; set; }
    public string? Error { get; set; }

    public int TotalFiles { get; set; }
    public int ScannedFiles { get; set; }
    public int AddedTracks { get; set; }
    public int UpdatedTracks { get; set; }
    public int RemovedTracks { get; set; }
    public int SkippedFiles { get; set; }

    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}
