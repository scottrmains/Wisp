using Wisp.Core.Tracks;

namespace Wisp.Infrastructure.Library;

public sealed record ScanProgress(
    Guid ScanJobId,
    ScanStatus Status,
    int TotalFiles,
    int ScannedFiles,
    int AddedTracks,
    int UpdatedTracks,
    int RemovedTracks,
    int SkippedFiles,
    string? Error);

public sealed record ScanRequest(Guid ScanJobId, string FolderPath);
