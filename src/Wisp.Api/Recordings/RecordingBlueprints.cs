using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Wisp.Core.Recordings;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Recordings;

public static class RecordingBlueprints
{
    // Call within the same transaction/save as session registration or linking.
    public static async Task<RecordingPlanSnapshot> Capture(WispDbContext db, Guid recordingId, Guid planId, Guid snapshotId, string timing)
    {
        var plan = await db.MixPlans.AsNoTracking().Include(p => p.Tracks).ThenInclude(t => t.Track).AsSingleQuery().SingleOrDefaultAsync(p => p.Id == planId)
            ?? throw new ArgumentException("That Mix Plan no longer exists. Choose another plan or record without one.");
        var blueprint = new Blueprint(plan.Notes, plan.Tracks.OrderBy(t => t.Order).ThenBy(t => t.Id).Select(t => new BlueprintEntry(
            Guid.NewGuid(), t.Id, t.TrackId, t.Track?.Artist ?? "", !string.IsNullOrWhiteSpace(t.Track?.Title) ? t.Track.Title : !string.IsNullOrWhiteSpace(t.Track?.FileName) ? t.Track.FileName : "Missing track",
            t.Track?.Bpm, t.Track?.MusicalKey, t.CueInSeconds, t.CueOutSeconds, t.TransitionNotes, t.IsAnchor)).ToArray());
        if (blueprint.Entries.Length > 500) throw new ArgumentException("This plan has more than 500 entries. Use a smaller plan or record without linking it.");
        return new() { Id = snapshotId, RecordingId = recordingId, SourcePlanId = planId, PlanName = plan.Name,
            SourceUpdatedAt = plan.UpdatedAt, TakenAt = DateTime.UtcNow, Timing = timing, BlueprintJson = JsonSerializer.Serialize(blueprint) };
    }
}
