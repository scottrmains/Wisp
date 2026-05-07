using System.Globalization;
using System.Text;
using Wisp.Core.MixPlans;

namespace Wisp.Api.MixPlans;

public static class MixPlanExporter
{
    public static string ToM3u(MixPlan plan)
    {
        var sb = new StringBuilder();
        sb.AppendLine("#EXTM3U");
        sb.AppendLine($"#PLAYLIST:{plan.Name}");

        foreach (var mpt in plan.Tracks.OrderBy(t => t.Order))
        {
            var t = mpt.Track;
            if (t is null) continue;

            var seconds = (int)Math.Round(t.Duration.TotalSeconds);
            var artist = t.Artist ?? "Unknown";
            var title = t.Title ?? Path.GetFileNameWithoutExtension(t.FilePath);
            sb.AppendLine($"#EXTINF:{seconds},{artist} - {title}");
            sb.AppendLine(t.FilePath);
        }
        return sb.ToString();
    }

    public static string ToCsv(MixPlan plan)
    {
        var sb = new StringBuilder();
        sb.AppendLine("Order,Artist,Title,Version,BPM,Key,Energy,DurationSeconds,FilePath,TransitionNotes");

        var i = 0;
        foreach (var mpt in plan.Tracks.OrderBy(t => t.Order))
        {
            i++;
            var t = mpt.Track;
            if (t is null) continue;

            sb.Append(i.ToString(CultureInfo.InvariantCulture)).Append(',');
            sb.Append(Csv(t.Artist)).Append(',');
            sb.Append(Csv(t.Title)).Append(',');
            sb.Append(Csv(t.Version)).Append(',');
            sb.Append(t.Bpm?.ToString(CultureInfo.InvariantCulture) ?? "").Append(',');
            sb.Append(Csv(t.MusicalKey)).Append(',');
            sb.Append(t.Energy?.ToString(CultureInfo.InvariantCulture) ?? "").Append(',');
            sb.Append(t.Duration.TotalSeconds.ToString("0.##", CultureInfo.InvariantCulture)).Append(',');
            sb.Append(Csv(t.FilePath)).Append(',');
            sb.Append(Csv(mpt.TransitionNotes)).AppendLine();
        }
        return sb.ToString();
    }

    private static string Csv(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        var needsQuotes = value.Contains(',') || value.Contains('"') || value.Contains('\n') || value.Contains('\r');
        if (!needsQuotes) return value;
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }
}
