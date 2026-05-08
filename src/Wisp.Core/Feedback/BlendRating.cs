namespace Wisp.Core.Feedback;

/// User's verdict on a particular A→B transition after auditioning it in the
/// blend preview modal. Seeded for a future feedback-aware recommender; for now
/// it's purely captured + displayed back when the same pair is opened again.
public class BlendRating
{
    public Guid Id { get; set; }

    /// Track on the LEFT of the transition. Foreign key only — we don't navigate
    /// from rating → track because we want to keep the rating row even if the user
    /// later removes one of the tracks.
    public Guid TrackAId { get; set; }
    public Guid TrackBId { get; set; }

    public BlendRatingValue Rating { get; set; }

    /// Optional one-line note ("works on the upbeat", "needed the +2% sync", etc.).
    public string? ContextNotes { get; set; }

    public DateTime RatedAt { get; set; }
}

public enum BlendRatingValue
{
    Bad = 1,
    Maybe = 2,
    Good = 3,
    Great = 4,
}
