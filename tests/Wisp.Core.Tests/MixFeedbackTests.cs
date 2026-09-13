using Wisp.Core.Recordings;

namespace Wisp.Core.Tests;
public class MixFeedbackTests
{
    private static MixAnnotation Note => new(Guid.NewGuid(), 0, null, "Keep this", "Keep this", false, null, null);
    [Theory]
    [InlineData(double.NaN)] [InlineData(double.PositiveInfinity)] [InlineData(-1)] [InlineData(61)]
    public void Rejects_invalid_points(double time) => Assert.Throws<ArgumentException>(() => MixFeedbackRules.Validate("", "Practice", [Note with { Seconds = time }], 60));
    [Theory]
    [InlineData(double.NaN)] [InlineData(double.PositiveInfinity)] [InlineData(0)] [InlineData(-1)] [InlineData(61)]
    public void Rejects_invalid_ranges(double end) => Assert.Throws<ArgumentException>(() => MixFeedbackRules.Validate("", "Practice", [Note with { EndSeconds = end }], 60));
    [Fact]
    public void Allows_zero_end_of_file_overlapping_ranges_and_unassigned_feedback()
    {
        MixFeedbackRules.Validate("Review", "Ready to share", [Note, Note with { Seconds = 60 }, Note with { EndSeconds = 60 }, Note with { Seconds = 10, EndSeconds = 20 }], 60);
    }
    [Fact]
    public void Rejects_duplicates_invalid_status_category_associations_and_excessive_text()
    {
        var n = Note;
        foreach (var notes in new MixAnnotation[]?[] { null, [null!], [n, n], [n with { Id = Guid.Empty }], [n with { Text = " " }], [n with { Text = new string('x', 4001) }], [n with { Category = "Invalid" }], [n with { ToOccurrenceId = Guid.NewGuid() }], [n with { OccurrenceId = n.Id, ToOccurrenceId = n.Id }] })
            Assert.Throws<ArgumentException>(() => MixFeedbackRules.Validate("", "Practice", notes, 60));
        Assert.Throws<ArgumentException>(() => MixFeedbackRules.Validate(new string('x', 10001), "Practice", [], 60));
        Assert.Throws<ArgumentException>(() => MixFeedbackRules.Validate("", "Not a status", [], 60));
    }
}
