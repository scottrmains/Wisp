namespace Wisp.Core.Tracks;

public class Track
{
    public Guid Id { get; set; }

    public string FilePath { get; set; } = "";
    public string FileName { get; set; } = "";
    public string FileHash { get; set; } = "";

    public string? Artist { get; set; }
    public string? Title { get; set; }
    public string? Version { get; set; }
    public string? Album { get; set; }
    public string? Genre { get; set; }

    public decimal? Bpm { get; set; }
    public string? MusicalKey { get; set; }
    public int? Energy { get; set; }
    public int? ReleaseYear { get; set; }

    public TimeSpan Duration { get; set; }

    public DateTime AddedAt { get; set; }
    public DateTime? LastScannedAt { get; set; }

    public bool IsMissingMetadata { get; set; }
    public bool IsDirtyName { get; set; }
}
