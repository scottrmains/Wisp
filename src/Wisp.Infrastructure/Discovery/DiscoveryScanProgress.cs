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
    string? Error);

public sealed record DiscoveryScanRequest(Guid SourceId);
