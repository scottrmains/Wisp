namespace Wisp.Core.Recordings;

// Deliberately no cascading relationship to live plans/tracks: historical text
// and occurrence identities must outlive library cleanup and plan deletion.
public sealed class RecordingTracklist
{
    public Guid Id { get; set; }
    public Guid? ActiveSnapshotId { get; set; }
    public int Revision { get; set; }
    public string EntriesJson { get; set; } = "[]";
}
public sealed class RecordingPlanSnapshot
{
    public Guid Id { get; set; }
    public Guid RecordingId { get; set; }
    public Guid SourcePlanId { get; set; }
    public string PlanName { get; set; } = "";
    public DateTime SourceUpdatedAt { get; set; }
    public DateTime TakenAt { get; set; }
    public string Timing { get; set; } = "At recording start";
    public string BlueprintJson { get; set; } = "{}";
}
public sealed record BlueprintEntry(Guid Id, Guid PlanEntryId, Guid TrackId, string Artist, string Title,
    decimal? Bpm, string? MusicalKey, double? CueInSeconds, double? CueOutSeconds, string? TransitionNotes, bool IsAnchor);
public sealed record Blueprint(string? Notes, BlueprintEntry[] Entries);
public sealed record PerformedEntry(Guid Id, Guid? TrackId, string Artist, string Title,
    bool Played, double? StartSeconds, Guid? BlueprintEntryId);

public static class PerformedTracklist
{
    public static void Validate(PerformedEntry[]? entries, double duration)
    {
        if (entries == null || entries.Length > 500 || entries.Any(e => e == null || e.Id == Guid.Empty ||
            string.IsNullOrWhiteSpace(e.Title) || e.Title.Length > 300 || e.Artist == null || e.Artist.Length > 300 ||
            (e.StartSeconds.HasValue && (!e.Played || !double.IsFinite(e.StartSeconds.Value) || e.StartSeconds < 0 || e.StartSeconds > duration))) ||
            entries.Select(e => e.Id).Distinct().Count() != entries.Length)
            throw new ArgumentException("Use distinct track occurrences, titles up to 300 characters and valid starts within this recording. Timestamped entries must be confirmed played (maximum 500 entries).");
    }
    public static bool TimesDisagree(PerformedEntry[] entries)
    {
        double last = -1;
        foreach (var entry in entries.Where(e => e.StartSeconds.HasValue))
        { if (entry.StartSeconds < last) return true; last = entry.StartSeconds!.Value; }
        return false;
    }
}
