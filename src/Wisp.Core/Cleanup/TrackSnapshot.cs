namespace Wisp.Core.Cleanup;

public sealed record TrackSnapshot(
    string FilePath,
    string FileName,
    string? Artist,
    string? Title,
    string? Version,
    string? Album,
    string? Genre);

public enum CleanupChangeKind
{
    StripJunk,
    TitleCase,
    ExtractVersion,
    RenameFile,
    TrimWhitespace,
}

public sealed record CleanupChange(
    CleanupChangeKind Kind,
    string Field,
    string Description,
    string Before,
    string After);

public sealed record CleanupSuggestion(
    Guid TrackId,
    TrackSnapshot Before,
    TrackSnapshot After,
    IReadOnlyList<CleanupChange> Changes)
{
    public bool HasChanges => Changes.Count > 0;
}
