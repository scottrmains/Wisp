namespace Wisp.Infrastructure.ExternalCatalog;

public sealed record CatalogArtistCandidate(
    string Source,
    string ExternalId,
    string Name,
    int? Followers,
    string[] Genres,
    string? ImageUrl);

public sealed record CatalogReleaseSummary(
    string Source,
    string ExternalId,
    string Title,
    string ReleaseType,    // album | single | ep | compilation | appears_on
    DateOnly? ReleaseDate,
    string? Url,
    string? ArtworkUrl);
