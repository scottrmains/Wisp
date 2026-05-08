using Wisp.Core.Discovery;

namespace Wisp.Api.Discovery;

public sealed record DiscoverySourceDto(
    Guid Id,
    string Name,
    DiscoverySourceType SourceType,
    string SourceUrl,
    string ExternalSourceId,
    DateTime AddedAt,
    DateTime? LastScannedAt,
    int ImportedCount)
{
    public static DiscoverySourceDto From(DiscoverySource s) => new(
        s.Id, s.Name, s.SourceType, s.SourceUrl, s.ExternalSourceId,
        s.AddedAt, s.LastScannedAt, s.ImportedCount);
}

public sealed record CreateSourceRequest(string Url);

public sealed record DiscoveredTrackDto(
    Guid Id,
    Guid DiscoverySourceId,
    string SourceVideoId,
    string SourceUrl,
    string RawTitle,
    string? ThumbnailUrl,
    string? ParsedArtist,
    string? ParsedTitle,
    string? MixVersion,
    int? ReleaseYear,
    DiscoveryStatus Status,
    bool IsAlreadyInLibrary,
    Guid? MatchedLocalTrackId,
    DateTime ImportedAt,
    DateTime? LastMatchedAt)
{
    public static DiscoveredTrackDto From(DiscoveredTrack t) => new(
        t.Id, t.DiscoverySourceId, t.SourceVideoId, t.SourceUrl, t.RawTitle, t.ThumbnailUrl,
        t.ParsedArtist, t.ParsedTitle, t.MixVersion, t.ReleaseYear,
        t.Status, t.IsAlreadyInLibrary, t.MatchedLocalTrackId, t.ImportedAt, t.LastMatchedAt);
}

public sealed record DigitalMatchDto(
    Guid Id,
    string Source,
    string Url,
    string Artist,
    string Title,
    string? Version,
    int? Year,
    MatchAvailability Availability,
    int ConfidenceScore,
    DateTime MatchedAt)
{
    public static DigitalMatchDto From(DigitalMatch m) => new(
        m.Id, m.Source, m.Url, m.Artist, m.Title, m.Version, m.Year,
        m.Availability, m.ConfidenceScore, m.MatchedAt);
}

public sealed record UpdateParseRequest(string? Artist, string? Title, string? Version, int? Year);
public sealed record UpdateStatusRequest(DiscoveryStatus Status);
