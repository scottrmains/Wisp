using Wisp.Core.Recordings;

namespace Wisp.Core.Tests;

public class PerformedTracklistTests
{
    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(-1)]
    [InlineData(61)]
    public void Rejects_invalid_times(double time) => Assert.Throws<ArgumentException>(() => PerformedTracklist.Validate([new(Guid.NewGuid(), null, "", "Track", true, time, null)], 60));
    [Fact]
    public void Allows_equal_starts_repeats_and_separately_confirmed_untimed_entries()
    {
        PerformedEntry[] entries = [new(Guid.NewGuid(), null, "", "Track", true, 0, null), new(Guid.NewGuid(), null, "", "Track", true, 0, null), new(Guid.NewGuid(), null, "", "Track", true, null, null)];
        PerformedTracklist.Validate(entries, 60); Assert.False(PerformedTracklist.TimesDisagree(entries));
    }
    [Fact]
    public void Rejects_null_empty_identity_duplicate_occurrences_and_excessive_counts()
    {
        var entry = new PerformedEntry(Guid.NewGuid(), null, "", "Track", false, null, null);
        foreach (var entries in new PerformedEntry[]?[] { null, [null!], [entry with { Id = Guid.Empty }], [entry, entry], [entry with { Title = " " }], Enumerable.Range(0, 501).Select(_ => entry with { Id = Guid.NewGuid() }).ToArray() })
            Assert.Throws<ArgumentException>(() => PerformedTracklist.Validate(entries, 60));
    }
}
