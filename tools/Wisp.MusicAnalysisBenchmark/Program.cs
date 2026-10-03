using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Wisp.Infrastructure.Audio;

// Read-only benchmark: no database, profile, tag writes, source copies or downloads.
// Existing tags are a comparison reference, NOT independently verified ground truth.
if (args.Length != 6 || args[0] != "--ffmpeg" || args[2] != "--folder" || args[4] != "--limit" ||
    !File.Exists(args[1]) || !Directory.Exists(args[3]) || !int.TryParse(args[5], out var limit) || limit is < 1 or > 1000)
{
    Console.Error.WriteLine("Usage: --ffmpeg <ffmpeg.exe> --folder <music folder> --limit <1..1000>. Outputs read-only comparisons as JSON lines; never changes files.");
    return 1;
}
var analyzer = new MusicAnalyzer(new Mp3Transcoder(NullLogger<Mp3Transcoder>.Instance, () => args[1]));
using var cancellation = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; cancellation.Cancel(); };
var extensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".mp3", ".wav", ".aiff", ".aif", ".flac", ".m4a", ".ogg" };
var count = 0; var tempoCompared = 0; var tempoMatches = 0; var preciseMatches = 0; var octaveMatches = 0; var keysCompared = 0; var keyMatches = 0;
foreach (var path in Directory.EnumerateFiles(args[3], "*", new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true })
    .Where(p => extensions.Contains(Path.GetExtension(p))).Order(StringComparer.OrdinalIgnoreCase))
{
    if (count >= limit || cancellation.IsCancellationRequested) break;
    try
    {
        decimal? taggedBpm; string? taggedKey;
        using (var media = TagLib.File.Create(path))
        {
            taggedBpm = media.Tag.BeatsPerMinute > 0 ? media.Tag.BeatsPerMinute : null;
            taggedKey = string.IsNullOrWhiteSpace(media.Tag.InitialKey) ? null : media.Tag.InitialKey.Trim().ToUpperInvariant();
        }
        if (taggedBpm is null && taggedKey is null) continue;
        count++;
        var watch = System.Diagnostics.Stopwatch.StartNew();
        var result = await analyzer.AnalyzeAsync(path, true, true, cancellation.Token);
        decimal? delta = null, octaveDelta = null;
        if (taggedBpm is { } bpm && result.Bpm is { } found)
        {
            delta = Math.Abs(bpm - found); octaveDelta = new[] { delta.Value, Math.Abs(bpm - found / 2), Math.Abs(bpm - found * 2) }.Min();
            tempoCompared++; if (delta <= 1) tempoMatches++; if (delta <= 0.1m) preciseMatches++; if (octaveDelta <= 1) octaveMatches++;
        }
        bool? keyMatch = null;
        if (taggedKey is not null && Wisp.Core.Music.Camelot.TryParse(taggedKey, out _))
        { keysCompared++; keyMatch = result.Key == taggedKey; if (keyMatch == true) keyMatches++; }
        Console.WriteLine(JsonSerializer.Serialize(new { file = Path.GetFileName(path), taggedBpm, taggedKey, result, delta, octaveDelta, keyMatch, elapsedSeconds = watch.Elapsed.TotalSeconds }));
    }
    catch (OperationCanceledException) { break; }
    catch (Exception ex) { Console.WriteLine(JsonSerializer.Serialize(new { file = Path.GetFileName(path), error = ex.Message })); }
}
Console.WriteLine(JsonSerializer.Serialize(new { summary = true, examined = count, tempoCompared, tempoMatchesWithinOneBpm = tempoMatches,
    tempoMatchesWithinPointOneBpm = preciseMatches,
    tempoMatchesIncludingHalfDouble = octaveMatches, camelotKeysCompared = keysCompared, exactKeyMatches = keyMatches,
    caution = "Tag agreement is not accuracy. Small non-random samples cannot establish parity with commercial analysers." }));
return 0;
