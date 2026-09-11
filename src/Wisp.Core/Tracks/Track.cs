namespace Wisp.Core.Tracks;

public class Track
{
    public Guid Id { get; set; }

    public string FilePath { get; set; } = "";
    public string FileName { get; set; } = "";
    public string FileHash { get; set; } = "";

    /// FilePath is the active version, used consistently by playback and exports.
    /// Originals and generated copies are never overwritten by normalisation.
    public string? OriginalFilePath { get; set; }
    public string? NormalizedFilePath { get; set; }
    public string? LoudnessAnalysisJson { get; set; }
    public string? NormalizationJson { get; set; }

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
    /// File-system last-write time in UTC, refreshed by scans and Wisp tag writes.
    /// Distinct from import time and scan time; null when the file cannot be read.
    public DateTime? FileModifiedAt { get; set; }
    public DateTime? LastScannedAt { get; set; }

    public bool IsMissingMetadata { get; set; }
    public bool IsDirtyName { get; set; }

    /// The last scan did not find this file beneath its registered library root.
    /// Keep the row (and its cues, playlists, tags and mix-plan references) so a
    /// moved drive or a transiently unavailable folder never destroys DJ prep.
    /// A future explicit "forget missing tracks" action is the only place a
    /// missing track may be permanently deleted.
    public bool IsUnavailable { get; set; }
    public DateTime? UnavailableSince { get; set; }

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
