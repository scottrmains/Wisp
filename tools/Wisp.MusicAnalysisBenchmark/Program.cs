using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Wisp.Infrastructure.Audio;

// Read-only benchmark: no database, profile, tag writes, source copies or downloads.
// Existing tags are a comparison reference, NOT independently verified ground truth.
var seed = 0; var skip = 0;
if (args.Length is not (6 or 8 or 10) || args[0] != "--ffmpeg" || args[2] != "--folder" || args[4] != "--limit" ||
    args.Length >= 8 && (args[6] != "--sample-seed" || !int.TryParse(args[7], out seed)) ||
    args.Length == 10 && (args[8] != "--skip" || !int.TryParse(args[9], out skip) || skip < 0) ||
    !File.Exists(args[1]) || !Directory.Exists(args[3]) || !int.TryParse(args[5], out var limit) || limit is < 1 or > 1000)
{
    Console.Error.WriteLine("Usage: --ffmpeg <ffmpeg.exe> --folder <music folder> --limit <1..1000> [--sample-seed <int> [--skip <tagged files>]]. Outputs read-only comparisons as JSON lines; never changes files.");
    return 1;
}
var analyzer = new MusicAnalyzer(new Mp3Transcoder(NullLogger<Mp3Transcoder>.Instance, () => args[1]));
using var cancellation = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; cancellation.Cancel(); };
var extensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".mp3", ".wav", ".aiff", ".aif", ".flac", ".m4a", ".ogg" };
var count = 0; var eligible = 0; var tempoCompared = 0; var tempoMatches = 0; var preciseMatches = 0; var octaveMatches = 0; var keysCompared = 0; var keyMatches = 0;
var files = Directory.EnumerateFiles(args[3], "*", new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true })
    .Where(p => extensions.Contains(Path.GetExtension(p))).Order(StringComparer.OrdinalIgnoreCase).ToArray();
if (args.Length >= 8) new Random(seed).Shuffle(files);
foreach (var path in files)
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
        if (eligible++ < skip) continue;
        count++;
        var watch = System.Diagnostics.Stopwatch.StartNew();
        var result = await analyzer.AnalyzeAsync(path, true, true, cancellation.Token);
        // The owner's filename convention can supply a reference, never an analyser input.
        var match = System.Text.RegularExpressions.Regex.Match(Path.GetFileNameWithoutExtension(path), @" - (\d{2,3}(?:\.\d{1,2})?)$");
        decimal? fileNameBpm = match.Success && decimal.TryParse(match.Groups[1].Value, System.Globalization.NumberStyles.Number,
            System.Globalization.CultureInfo.InvariantCulture, out var namedBpm) && namedBpm is >= 40 and <= 250 ? namedBpm : null;
        decimal? delta = null, octaveDelta = null;
        if ((taggedBpm ?? fileNameBpm) is { } bpm && result.Bpm is { } found)
        {
            delta = Math.Abs(bpm - found); octaveDelta = new[] { delta.Value, Math.Abs(bpm - found / 2), Math.Abs(bpm - found * 2) }.Min();
            tempoCompared++; if (delta <= 1) tempoMatches++; if (delta <= 0.1m) preciseMatches++; if (octaveDelta <= 1) octaveMatches++;
        }
        bool? keyMatch = null;
        if (taggedKey is not null && Wisp.Core.Music.Camelot.TryParse(taggedKey, out _))
        { keysCompared++; keyMatch = result.Key == taggedKey; if (keyMatch == true) keyMatches++; }
        Console.WriteLine(JsonSerializer.Serialize(new { file = Path.GetFileName(path), taggedBpm, fileNameBpm, taggedKey, result, delta, octaveDelta, keyMatch, elapsedSeconds = watch.Elapsed.TotalSeconds }));
    }
    catch (OperationCanceledException) { break; }
    catch (Exception ex) { Console.WriteLine(JsonSerializer.Serialize(new { file = Path.GetFileName(path), error = ex.Message })); }
}
Console.WriteLine(JsonSerializer.Serialize(new { summary = true, examined = count, tempoCompared, tempoMatchesWithinOneBpm = tempoMatches,
    tempoMatchesWithinPointOneBpm = preciseMatches,
    tempoMatchesIncludingHalfDouble = octaveMatches, camelotKeysCompared = keysCompared, exactKeyMatches = keyMatches,
    caution = "Agreement with tags/filename references is not independently verified accuracy or parity with commercial analysers." }));
return 0;
