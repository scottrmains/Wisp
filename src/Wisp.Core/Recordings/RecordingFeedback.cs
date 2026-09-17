namespace Wisp.Core.Recordings;

// Independent of capture and quick-marker/rating writes. No cascade from library entities.
public sealed class RecordingFeedback
{
    public Guid Id { get; set; }
    public int Revision { get; set; }
    public string Notes { get; set; } = "";
    public string Status { get; set; } = "Practice";
    public string AnnotationsJson { get; set; } = "[]";
}

public sealed record MixAnnotation(Guid Id, double Seconds, double? EndSeconds, string Text, string? Category,
    bool Resolved, Guid? OccurrenceId, Guid? ToOccurrenceId, string? AssociationLabel = null);

public static class MixFeedbackRules
{
    public static readonly string[] Statuses = ["Practice", "Needs review", "Ready to share"];
    public static readonly string[] Categories = ["Transition", "Phrasing", "Levels", "Track choice", "Keep this"];
    public static void Validate(string? notes, string? status, MixAnnotation[]? annotations, double duration)
    {
        if (notes == null || notes.Length > 10000 || !Statuses.Contains(status) || annotations == null || annotations.Length > 500 ||
            annotations.Any(a => a == null || a.Id == Guid.Empty || string.IsNullOrWhiteSpace(a.Text) || a.Text.Length > 4000 ||
                (a.Category != null && !Categories.Contains(a.Category)) || !double.IsFinite(a.Seconds) || a.Seconds < 0 || a.Seconds > duration ||
                (a.EndSeconds.HasValue && (!double.IsFinite(a.EndSeconds.Value) || a.EndSeconds <= a.Seconds || a.EndSeconds > duration)) ||
                (a.ToOccurrenceId.HasValue && (!a.OccurrenceId.HasValue || a.ToOccurrenceId == a.OccurrenceId))) ||
            annotations.Select(a => a.Id).Distinct().Count() != annotations.Length)
            throw new ArgumentException("Use a valid review status, notes up to 10,000 characters and up to 500 comments of 4,000 characters. Times must be within the recording, and ranges must end after they start.");
    }
}

public sealed class RecordingPlanRevision
{
    // Also the newly created MixPlan ID: stable idempotency and lineage even after deletion.
    public Guid Id { get; set; }
    public Guid RecordingId { get; set; }
    public Guid? ParentPlanId { get; set; }
    public Guid? SnapshotId { get; set; }
    public string PlanName { get; set; } = "";
    public string RecordingTitle { get; set; } = "";
    public string Source { get; set; } = "actual";
    public DateTime CreatedAt { get; set; }
    public string RequestHash { get; set; } = "";
    public string ContextJson { get; set; } = "{}";
}
