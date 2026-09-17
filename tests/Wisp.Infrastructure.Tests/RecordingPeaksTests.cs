using Wisp.Infrastructure.Audio;

namespace Wisp.Infrastructure.Tests;

public sealed class RecordingPeaksTests
{
    [Fact]
    public async Task Extrema_survive_coarser_levels_and_cancellation_is_observed()
    {
        var root = Path.Combine(Path.GetTempPath(), "wisp-peaks-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root); var path = Path.Combine(root, "master.wav");
        try
        {
            const int frames = 8000 * 60;
            using (var stream = File.Create(path))
            using (var writer = new BinaryWriter(stream))
            {
                writer.Write(RecordingDiskStore.Header(8000, frames * 8));
                for (int i = 0; i < frames; i++) { writer.Write(i == 100 ? -.9f : -.1f); writer.Write(i == frames - 1 ? .8f : .2f); }
            }
            var peaks = await RecordingPeaks.Generate(path, 8000, frames * 8, "test", _ => { }, CancellationToken.None);
            Assert.True(peaks.Levels.Length > 1); Assert.Equal(60, peaks.Duration);
            Assert.All(peaks.Levels, level => { Assert.Equal(-.9f, level.Min.Min()); Assert.Equal(.8f, level.Max.Max()); });
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => RecordingPeaks.Generate(path, 8000, frames * 8, "test", _ => { }, new CancellationToken(true)));
        }
        finally { Directory.Delete(root, true); }
    }
}
