using Wisp.Core.Tracks;

namespace Wisp.Core.Tagging;

/// User-authored label on a track describing how it's used in a set
/// (warm-up / peak-time / vocal-heavy / dark / 90s / …). Distinct from genre,
/// which describes the track itself, not the role it plays in a mix.
///
/// Tags are free-form strings — the `Type` is just a hint for grouping in the UI.
/// Same `Name` can be applied to many tracks; same track cannot have the same
/// `Name` twice (unique index in `WispDbContext`).
public class TrackTag
{
    public Guid Id { get; set; }

    public Guid TrackId { get; set; }
    public Track? Track { get; set; }

    public string Name { get; set; } = "";

    public TrackTagType Type { get; set; }

    public DateTime CreatedAt { get; set; }
}

public enum TrackTagType
{
    /// Where the track sits in a set arc — opener, warm-up, builder, peak-time, closer, tool.
    Role = 1,
    /// Subjective feel — dark, uplifting, deep, tribal, garagey, dub, funky, soulful, minimal.
    Vibe = 2,
    /// Vocal characteristic — vocal-heavy, instrumental, acapella, dub.
    Vocal = 3,
    /// When it's from — 90s, early-00s, blog-era, current.
    Era = 4,
    /// Anything that doesn't fit one of the above buckets.
    Custom = 99,
}
