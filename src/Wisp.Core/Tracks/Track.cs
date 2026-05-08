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

    /// Free-text notes the user keeps against a track (in-key transitions, vinyl shop bought from, "for the warmup", etc.).
    /// Optional; null = no notes set.
    public string? Notes { get; set; }

    /// Soft archive — hidden from the default library view + recommendation pool until restored.
    /// The file on disk is never moved or deleted by this flag (hard archive is a future,
    /// opt-in feature that lives elsewhere). Default false; toggled via the archive endpoints.
    public bool IsArchived { get; set; }
    public DateTime? ArchivedAt { get; set; }
    public ArchiveReason? ArchiveReason { get; set; }
}

public enum ArchiveReason
{
    Outdated = 1,
    LowQuality = 2,
    Duplicate = 3,
    BadMetadata = 4,
    NotMyVibe = 5,
    KeepForMemory = 6,
    Other = 99,
}
