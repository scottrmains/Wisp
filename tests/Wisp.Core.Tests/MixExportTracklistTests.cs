using Wisp.Core.Recordings;

namespace Wisp.Core.Tests;

public sealed class MixExportTracklistTests
{
    [Fact]
    public void Text_preserves_occurrences_sorts_confirmed_times_and_separates_untimed()
    {
        PerformedEntry Entry(string title, bool played, double? time) => new(Guid.NewGuid(), null, "Artist\nName", title, played, time, null);
        var text = MixExportTracklist.Build("Test\nMix", new(2026, 9, 13), [Entry("Later", true, 3601.125), Entry("Repeat", true, 0),
            Entry("Repeat", true, 0), Entry("No time", true, null), Entry("Draft", false, null)], 4000);
        Assert.StartsWith("Test Mix", text); Assert.Contains("01:00:01.125", text); Assert.Contains("00:00:00.000", text);
        Assert.Equal(2, text.Split("Repeat").Length - 1); Assert.Contains("Untimed  Artist Name", text); Assert.DoesNotContain("Draft", text);
        Assert.True(text.IndexOf("Repeat", StringComparison.Ordinal) < text.IndexOf("Later", StringComparison.Ordinal));
    }
    [Theory]
    [InlineData(double.NaN)] [InlineData(-1)] [InlineData(61)]
    public void Invalid_saved_times_are_not_exported(double seconds) => Assert.Throws<ArgumentException>(() =>
        MixExportTracklist.Build("Mix", DateTime.UtcNow, [new(Guid.NewGuid(), null, "", "Track", true, seconds, null)], 60));
}
