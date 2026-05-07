using Wisp.Core.Cues;

namespace Wisp.Api.Cues;

public sealed record CuePointDto(
    Guid Id,
    Guid TrackId,
    double TimeSeconds,
    string Label,
    CuePointType Type,
    bool IsAutoSuggested,
    DateTime CreatedAt)
{
    public static CuePointDto From(CuePoint c) => new(
        c.Id, c.TrackId, c.TimeSeconds, c.Label, c.Type, c.IsAutoSuggested, c.CreatedAt);
}

public sealed record CreateCueRequest(
    double TimeSeconds,
    string? Label,
    CuePointType Type);

public sealed record UpdateCueRequest(
    double? TimeSeconds,
    string? Label,
    CuePointType? Type);

public sealed record GeneratePhraseMarkersRequest(
    double FirstBeatSeconds,
    int StepBeats = 16,
    bool ReplaceExisting = true);
