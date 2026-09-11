namespace Wisp.Infrastructure.ExternalCatalog.Soulseek;

public static class SoulseekTransferState
{
    public static bool Has(string state, string flag) => state.Split(',', StringSplitOptions.TrimEntries)
        .Contains(flag, StringComparer.OrdinalIgnoreCase);

    public static bool IsFinished(string state) => new[]
        { "Completed", "Succeeded", "Cancelled", "Errored", "TimedOut", "Rejected", "Aborted", "Failed" }
        .Any(flag => Has(state, flag));

    public static bool IsSuccessful(string state) => Has(state, "Succeeded") &&
        !new[] { "Cancelled", "Errored", "TimedOut", "Rejected", "Aborted", "Failed" }.Any(flag => Has(state, flag));
}
