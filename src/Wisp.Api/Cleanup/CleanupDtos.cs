using Wisp.Core.Cleanup;

namespace Wisp.Api.Cleanup;

public sealed record CleanupSuggestionDto(
    Guid TrackId,
    TrackSnapshot Before,
    TrackSnapshot After,
    IReadOnlyList<CleanupChange> Changes,
    bool HasChanges);

public sealed record AuditDto(
    Guid Id,
    Guid TrackId,
    CleanupAction Action,
    CleanupStatus Status,
    string? FailureReason,
    string FilePathBefore,
    string FilePathAfter,
    DateTime CreatedAt);
