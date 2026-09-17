using System.Globalization;
using System.Text;

namespace Wisp.Core.Recordings;

public sealed class RecordingExport
{
    public Guid Id { get; set; }
    public Guid RecordingId { get; set; }
    public string RequestJson { get; set; } = "";
    public string Title { get; set; } = "";
    public string Format { get; set; } = "";
    public string DirectoryPath { get; set; } = "";
    public string State { get; set; } = "Running";
    public string? Error { get; set; }
    public DateTime CreatedAt { get; set; }
    public string SourceHash { get; set; } = "";
    public string? OutputHash { get; set; }
    public long OutputBytes { get; set; }
    public long OutputWriteTicks { get; set; }
    public string? TracklistText { get; set; }
}

public static class MixExportTracklist
{
    public static string Build(string title, DateTime recordedAt, PerformedEntry[] entries, double duration)
    {
        PerformedTracklist.Validate(entries, duration);
        static string Line(string value) => string.Join(" ", value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        var text = new StringBuilder().AppendLine(Line(title)).AppendLine(recordedAt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture))
            .AppendLine().AppendLine("Confirmed track entrances (recording-relative; overlapping transitions are possible)");
        foreach (var entry in entries.Where(e => e.Played && e.StartSeconds.HasValue).OrderBy(e => e.StartSeconds))
        {
            var ms = (long)Math.Round(entry.StartSeconds!.Value * 1000);
            text.AppendLine($"{ms / 3600000:00}:{ms / 60000 % 60:00}:{ms / 1000 % 60:00}.{ms % 1000:000}  {Line(entry.Artist)} — {Line(entry.Title)}");
        }
        var untimed = entries.Where(e => e.Played && !e.StartSeconds.HasValue).ToArray();
        if (untimed.Length > 0)
        {
            text.AppendLine().AppendLine("Confirmed played — entrance time not set (performance-list order)");
            foreach (var entry in untimed) text.AppendLine($"Untimed  {Line(entry.Artist)} — {Line(entry.Title)}");
        }
        text.AppendLine().AppendLine("Unconfirmed draft entries excluded. Review comments and ratings remain in WISP.");
        return text.ToString();
    }
}
