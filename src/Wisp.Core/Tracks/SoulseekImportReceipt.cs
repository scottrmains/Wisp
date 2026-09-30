namespace Wisp.Core.Tracks;

/// Durable import receipt, scoped to a daemon. Retained after clearing transfer
/// history so late polls and application restarts cannot index it twice.
public sealed class SoulseekImportReceipt
{
    public string Source { get; set; } = "";
    public string TransferId { get; set; } = "";
    public Guid ScanId { get; set; }
}
