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
    CuePointType Type,
    bool IsAutoSuggested = false);

public sealed record UpdateCueRequest(
    double? TimeSeconds,
    string? Label,
    CuePointType? Type);

public sealed record GeneratePhraseMarkersRequest(
    double FirstBeatSeconds,
    int StepBeats = 64,
    bool ReplaceExisting = true);

public sealed record DeviceCueDto(
    Guid Id,
    Guid TrackId,
    DeviceCueKind Kind,
    double StartSeconds,
    double? EndSeconds,
    string? Comment,
    Guid? SourceCuePointId,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public static DeviceCueDto From(DeviceCue cue) => new(
        cue.Id, cue.TrackId, cue.Kind, cue.StartSeconds, cue.EndSeconds,
        cue.Comment, cue.SourceCuePointId, cue.CreatedAt, cue.UpdatedAt);
}

public sealed record CreateDeviceCueRequest(
    DeviceCueKind Kind,
    double StartSeconds,
    double? EndSeconds,
    string? Comment,
    Guid? SourceCuePointId = null);

public sealed record UpdateDeviceCueRequest(
    DeviceCueKind? Kind,
    double? StartSeconds,
    double? EndSeconds,
    string? Comment);
