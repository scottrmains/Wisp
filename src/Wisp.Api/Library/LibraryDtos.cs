using Wisp.Core.Tracks;

namespace Wisp.Api.Library;

public sealed record StartScanRequest(string FolderPath);

public sealed record ScanJobDto(
    Guid Id,
    string FolderPath,
    ScanStatus Status,
    string? Error,
    int TotalFiles,
    int ScannedFiles,
    int AddedTracks,
    int UpdatedTracks,
    int RemovedTracks,
    int SkippedFiles,
    DateTime StartedAt,
    DateTime? CompletedAt)
{
    public static ScanJobDto From(ScanJob s) => new(
        s.Id, s.FolderPath, s.Status, s.Error,
        s.TotalFiles, s.ScannedFiles, s.AddedTracks, s.UpdatedTracks, s.RemovedTracks, s.SkippedFiles,
        s.StartedAt, s.CompletedAt);
}

public sealed record TrackDto(
    Guid Id,
    string FilePath,
    string FileName,
    string? Artist,
    string? Title,
    string? Version,
    string? Album,
    string? Genre,
    decimal? Bpm,
    string? MusicalKey,
    int? Energy,
    int? ReleaseYear,
    double DurationSeconds,
    bool IsMissingMetadata,
    bool IsDirtyName,
    DateTime AddedAt,
    DateTime? LastScannedAt)
{
    public static TrackDto From(Track t) => new(
        t.Id, t.FilePath, t.FileName,
        t.Artist, t.Title, t.Version, t.Album, t.Genre,
        t.Bpm, t.MusicalKey, t.Energy, t.ReleaseYear,
        t.Duration.TotalSeconds, t.IsMissingMetadata, t.IsDirtyName,
        t.AddedAt, t.LastScannedAt);
}

public sealed record TrackPageDto(IReadOnlyList<TrackDto> Items, int Total, int Page, int Size);

public sealed record TrackQuery(
    string? Search,
    string? Key,
    decimal? BpmMin,
    decimal? BpmMax,
    int? EnergyMin,
    int? EnergyMax,
    bool? Missing,
    string? Sort,
    int Page = 1,
    int Size = 100);

public sealed record RecommendationDto(
    TrackDto Track,
    int Total,
    int KeyScore,
    int BpmScore,
    int EnergyScore,
    int GenreScore,
    int Penalties,
    IReadOnlyList<string> Reasons);
