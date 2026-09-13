namespace Wisp.Infrastructure.Usb;

/// <summary>
/// Player analysis lookup is derived from the exact USB-relative audio path,
/// not the assigned DeviceSQL track ID. Matches the three private rekordbox
/// references and the folders created by the owner's CDJ-900.
/// Algorithm reference: fourfour/pioneer-usb-writer/reference-code/PIONEER.md,
/// section 1 (rekordbox CreateAnlzFileFolderPath disassembly).
/// </summary>
public static class PioneerAnalysisPath
{
    public static string ForAudio(string contentPath)
    {
        if (string.IsNullOrWhiteSpace(contentPath) || !contentPath.StartsWith('/') ||
            contentPath.Contains('\\') || contentPath.Contains('\0'))
            throw new ArgumentException("Use the exact slash-separated, USB-relative audio path.", nameof(contentPath));

        uint hash = 0;
        // Iterate UTF-16 code units, without changing case, punctuation or normalization.
        foreach (var codeUnit in contentPath)
            hash = unchecked((hash * 0x5bc9u + codeUnit) * 0x93b5u + codeUnit);
        hash %= 200003;
        var folder = (hash & 1) | ((hash >> 1) & 2) | ((hash >> 4) & 4) |
            ((hash >> 4) & 8) | ((hash >> 5) & 16) | ((hash >> 8) & 32) | ((hash >> 10) & 64);
        return $"/PIONEER/USBANLZ/P{folder:X3}/{hash:X8}/ANLZ0000.DAT";
    }

    public static void RequireDistinct(IReadOnlyList<PioneerExportTrack> tracks)
    {
        // The hash is deliberately small. Until multi-entry bucket allocation is
        // hardware-verified, reject collisions instead of overwriting another track.
        var collision = tracks.Where(t => !string.IsNullOrEmpty(t.AnalysisPath))
            .GroupBy(t => t.AnalysisPath, StringComparer.OrdinalIgnoreCase).FirstOrDefault(g => g.Count() > 1);
        if (collision is not null)
            throw new PioneerWaveformException("Two selected tracks share a Pioneer analysis folder. " +
                "Export them separately or change one track's export title before retrying: " +
                string.Join("; ", collision.Select(t => t.Track.Title ?? t.Track.FileName)));
    }
}
