namespace Wisp.Infrastructure.ExternalCatalog.Soulseek;

/// Flat per-file row aggregated across all responding users for a search.
public sealed record SoulseekSearchHit(
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
    bool HasFreeUploadSlot);

public sealed record SoulseekSearchResult(
    string Id,
    bool IsComplete,
    int ResponseCount,
    IReadOnlyList<SoulseekSearchHit> Hits);

public sealed record SoulseekTransfer(
    string Id,
    string Username,
    string Filename,
    long Size,
    long BytesTransferred,
    double Percentage,
    string State,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt);
