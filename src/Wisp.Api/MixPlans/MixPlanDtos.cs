using Wisp.Api.Library;
using Wisp.Core.MixPlans;

namespace Wisp.Api.MixPlans;

public sealed record MixPlanSummaryDto(
    Guid Id,
    string Name,
    string? Notes,
    int TrackCount,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public sealed record MixPlanDto(
    Guid Id,
    string Name,
    string? Notes,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    IReadOnlyList<MixPlanTrackDto> Tracks);

public sealed record MixPlanTrackDto(
    Guid Id,
    Guid TrackId,
    double Order,
    double? CueInSeconds,
    double? CueOutSeconds,
    string? TransitionNotes,
    TrackDto Track)
{
    public static MixPlanTrackDto From(MixPlanTrack mpt) => new(
        mpt.Id,
        mpt.TrackId,
        mpt.Order,
        mpt.CueInSeconds,
        mpt.CueOutSeconds,
        mpt.TransitionNotes,
        TrackDto.From(mpt.Track!));
}

public sealed record CreateMixPlanRequest(string Name, string? Notes);
public sealed record UpdateMixPlanRequest(string? Name, string? Notes);

public sealed record AddMixPlanTrackRequest(Guid TrackId, Guid? AfterMixPlanTrackId);
public sealed record UpdateMixPlanTrackRequest(Guid? AfterMixPlanTrackId, string? TransitionNotes);
