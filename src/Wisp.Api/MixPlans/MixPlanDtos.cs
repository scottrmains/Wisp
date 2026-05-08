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
    /// Playlist scoping the recommendation pool when building this plan.
    /// Null = unconstrained (recommendations consider the whole library).
    Guid? RecommendationScopePlaylistId,
    IReadOnlyList<MixPlanTrackDto> Tracks);

public sealed record MixPlanTrackDto(
    Guid Id,
    Guid TrackId,
    double Order,
    double? CueInSeconds,
    double? CueOutSeconds,
    string? TransitionNotes,
    bool IsAnchor,
    TrackDto Track)
{
    public static MixPlanTrackDto From(MixPlanTrack mpt) => new(
        mpt.Id,
        mpt.TrackId,
        mpt.Order,
        mpt.CueInSeconds,
        mpt.CueOutSeconds,
        mpt.TransitionNotes,
        mpt.IsAnchor,
        TrackDto.From(mpt.Track!));
}

public sealed record CreateMixPlanRequest(string Name, string? Notes);
public sealed record UpdateMixPlanRequest(
    string? Name,
    string? Notes,
    /// Tri-state: undefined (don't touch), null (clear scope), Guid (set scope to playlist).
    /// JSON's `null` distinguishes "explicit clear" from "field omitted" when deserialised.
    Guid? RecommendationScopePlaylistId,
    bool? ClearRecommendationScope);

public sealed record AddMixPlanTrackRequest(Guid TrackId, Guid? AfterMixPlanTrackId);
public sealed record UpdateMixPlanTrackRequest(Guid? AfterMixPlanTrackId, string? TransitionNotes, bool? IsAnchor);

/// Request to suggest a route between two anchored tracks. `GapTracks` is the desired number
/// of fillers to insert; the suggester will return at most a handful of candidate sequences.
public sealed record SuggestRouteRequest(Guid FromMptId, Guid ToMptId, int GapTracks);

public sealed record SuggestedRouteDto(
    IReadOnlyList<TrackDto> Tracks,
    int TotalScore,
    int WarningCount,
    string Summary);
