using Wisp.Infrastructure.ExternalCatalog.Soulseek;

namespace Wisp.Api.Soulseek;

public sealed record StartSearchRequest(string Query);

public sealed record SearchHitDto(
    string Username,
    string Filename,
    long Size,
    int? BitRate,
    int? SampleRate,
    int? BitDepth,
    int? Length,
    bool Locked,
    int UploadSpeed,
    int QueueLength,
    bool HasFreeUploadSlot)
{
    public static SearchHitDto From(SoulseekSearchHit h) => new(
        h.Username, h.Filename, h.Size, h.BitRate, h.SampleRate, h.BitDepth, h.Length,
        h.Locked, h.UploadSpeed, h.QueueLength, h.HasFreeUploadSlot);
}

public sealed record SearchResultDto(
    string Id,
    bool IsComplete,
    int ResponseCount,
    IReadOnlyList<SearchHitDto> Hits);

public sealed record QueueDownloadRequest(string Username, string Filename, long Size);

public sealed record TransferDto(
    string Id,
    string Username,
    string Filename,
    long Size,
    long BytesTransferred,
    double Percentage,
    string State,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt)
{
    public static TransferDto From(SoulseekTransfer t) => new(
        t.Id, t.Username, t.Filename, t.Size, t.BytesTransferred, t.Percentage,
        t.State, t.StartedAt, t.EndedAt);
}
