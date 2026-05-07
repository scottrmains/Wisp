namespace Wisp.Core.Cleanup;

public enum CleanupAction
{
    Cleanup,
    Undo,
}

public enum CleanupStatus
{
    Applied,
    RolledBack,
    Failed,
}

public class MetadataAuditLog
{
    public Guid Id { get; set; }

    /// Original TrackId. No FK — the audit row should outlive a deleted track.
    public Guid TrackId { get; set; }

    public CleanupAction Action { get; set; }
    public CleanupStatus Status { get; set; }
    public string? FailureReason { get; set; }

    /// JSON snapshot of TrackSnapshot (artist/title/version/album/genre/etc) before the change.
    public string BeforeJson { get; set; } = "";
    public string AfterJson { get; set; } = "";

    public string FilePathBefore { get; set; } = "";
    public string FilePathAfter { get; set; } = "";

    public DateTime CreatedAt { get; set; }
}
