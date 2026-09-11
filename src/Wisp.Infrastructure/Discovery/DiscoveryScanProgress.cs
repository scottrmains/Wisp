namespace Wisp.Infrastructure.Discovery;

public enum DiscoveryScanStatus
{
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

public sealed record DiscoveryScanProgress(
    Guid SourceId,
    DiscoveryScanStatus Status,
    int TotalImported,
    int NewItems,
    int ParsedConfidently,
    string? Error)
{
    public int UpdatedDates { get; init; }
    public int CheckedItems { get; init; }
    public DateTime? FinishedAt { get; init; }
}

public sealed record DiscoveryScanRequest(Guid SourceId);
