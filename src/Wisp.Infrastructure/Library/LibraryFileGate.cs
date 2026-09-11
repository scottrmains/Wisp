namespace Wisp.Infrastructure.Library;

/// A scan retains tracked entities until completion. Serialize file recovery with scans
/// so a scan cannot restore an old path or reinsert a just-removed entry mid-operation.
public static class LibraryFileGate
{
    public static SemaphoreSlim Instance { get; } = new(1, 1);
}
