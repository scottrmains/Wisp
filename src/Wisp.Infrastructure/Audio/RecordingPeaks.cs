using System.Buffers.Binary;

namespace Wisp.Infrastructure.Audio;

public sealed record PeakLevel(double SecondsPerBucket, float[] Min, float[] Max);
public sealed record RecordingPeakData(int Version, string Hash, double Duration, PeakLevel[] Levels, long LastWriteTicks, long FileBytes);

public static class RecordingPeaks
{
    // At most 200,000 fine buckets (~1.6 MB), regardless of mix length. Build
    // coarser levels by combining extrema, not resampling the original audio.
    public static async Task<RecordingPeakData> Generate(string path, int sampleRate, long bytes, string hash,
        Action<double> progress, CancellationToken ct)
    {
        RecordingDiskStore.Validate(path, sampleRate, bytes);
        long frames = bytes / 8;
        if (frames == 0) throw new IOException("The recording contains no audio.");
        var framesPerBucket = Math.Max(sampleRate / 20, (frames + 199999) / 200000);
        var count = checked((int)((frames + framesPerBucket - 1) / framesPerBucket));
        var min = Enumerable.Repeat(float.PositiveInfinity, count).ToArray();
        var max = Enumerable.Repeat(float.NegativeInfinity, count).ToArray();
        await using var file = File.OpenRead(path); file.Position = RecordingDiskStore.HeaderBytes;
        var buffer = new byte[65536]; long done = 0;
        while (done < bytes)
        {
            ct.ThrowIfCancellationRequested();
            int size = (int)Math.Min(buffer.Length, bytes - done);
            await file.ReadExactlyAsync(buffer.AsMemory(0, size), ct);
            for (int i = 0; i < size; i += 8)
            {
                int bucket = (int)((done + i) / 8 / framesPerBucket);
                var l = BinaryPrimitives.ReadSingleLittleEndian(buffer.AsSpan(i, 4));
                var r = BinaryPrimitives.ReadSingleLittleEndian(buffer.AsSpan(i + 4, 4));
                if (!float.IsFinite(l) || !float.IsFinite(r)) throw new IOException("Invalid samples in recording.");
                min[bucket] = Math.Min(min[bucket], Math.Min(l, r)); max[bucket] = Math.Max(max[bucket], Math.Max(l, r));
            }
            done += size; progress((double)done / bytes);
        }
        var levels = new List<PeakLevel> { new((double)framesPerBucket / sampleRate, min, max) };
        while (min.Length > 512)
        {
            var nextMin = new float[(min.Length + 3) / 4]; var nextMax = new float[nextMin.Length];
            for (int i = 0; i < nextMin.Length; i++)
            {
                nextMin[i] = min.Skip(i * 4).Take(4).Min(); nextMax[i] = max.Skip(i * 4).Take(4).Max();
            }
            levels.Add(new(levels[^1].SecondsPerBucket * 4, nextMin, nextMax)); min = nextMin; max = nextMax;
        }
        return new(1, hash, (double)frames / sampleRate, levels.ToArray(), File.GetLastWriteTimeUtc(path).Ticks, file.Length);
    }
}
