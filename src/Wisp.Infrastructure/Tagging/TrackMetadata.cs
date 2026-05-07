namespace Wisp.Infrastructure.Tagging;

public sealed record TrackMetadata
{
    public string? Artist { get; init; }
    public string? Title { get; init; }
    public string? Version { get; init; }
    public string? Album { get; init; }
    public string? Genre { get; init; }
    public decimal? Bpm { get; init; }
    public string? MusicalKey { get; init; }
    public int? Energy { get; init; }
    public int? ReleaseYear { get; init; }
    public TimeSpan Duration { get; init; }
    public bool IsMissingMetadata { get; init; }
}
