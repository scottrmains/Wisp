using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Wisp.Infrastructure.Audio;

internal static class ReferenceBenchmark
{
    private sealed record Sample(string Id, string Path, string ReferenceKey, string Sha256, string Split);
    private sealed record Manifest(int FormatVersion, string Dataset, string DatasetCommit, int Seed, Sample[] Samples);

    public static async Task<int> Run(string[] args)
    {
        if (args.Length != 8 || args[0] != "--manifest" || args[2] != "--ffmpeg" || args[4] != "--split" ||
            args[6] != "--output" || args[5] is not ("development" or "holdout") || !File.Exists(args[1]) || !File.Exists(args[3]))
        {
            Console.Error.WriteLine("Usage: --manifest <manifest.json> --ffmpeg <exe> --split <development|holdout> --output <new JSONL file>");
            return 1;
        }
        var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var manifest = JsonSerializer.Deserialize<Manifest>(await File.ReadAllTextAsync(args[1]), options) ?? throw new InvalidDataException("Invalid manifest");
        if (manifest.FormatVersion != 1 || manifest.Samples.Select(s => s.Id).Distinct().Count() != manifest.Samples.Length)
            throw new InvalidDataException("Unsupported format or duplicate sample IDs");
        var analyzer = new MusicAnalyzer(new Mp3Transcoder(NullLogger<Mp3Transcoder>.Instance, () => args[3]));
        using var cancellation = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; cancellation.Cancel(); };
        using var output = new StreamWriter(new FileStream(args[7], FileMode.CreateNew, FileAccess.Write));
        foreach (var sample in manifest.Samples.Where(s => s.Split == args[5]))
        {
            cancellation.Token.ThrowIfCancellationRequested();
            var watch = Stopwatch.StartNew();
            MusicAnalysis? result = null; string? error = null;
            try
            {
                await Verify(sample);
                result = await analyzer.AnalyzeAsync(sample.Path, false, true, cancellation.Token);
                await Verify(sample);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex) { error = ex.Message; result = null; }
            // No tags or filenames supply labels, inputs or exclusions. Failures stay in the denominator.
            await output.WriteLineAsync(JsonSerializer.Serialize(new { id = sample.Id, split = sample.Split,
                referenceKey = sample.ReferenceKey, engine = MusicFeatures.Engine, key = result?.Key, result, error,
                elapsedSeconds = watch.Elapsed.TotalSeconds }));
            await output.FlushAsync(cancellation.Token);
            Console.WriteLine($"{sample.Id}: {result?.Key ?? "error"} ({watch.Elapsed.TotalSeconds:F2}s)");
        }
        return 0;
    }

    private static async Task Verify(Sample sample)
    {
        await using var stream = File.OpenRead(sample.Path);
        var hash = Convert.ToHexString(await SHA256.HashDataAsync(stream));
        if (!hash.Equals(sample.Sha256, StringComparison.OrdinalIgnoreCase)) throw new IOException("Source checksum changed");
    }
}
