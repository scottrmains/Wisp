using System.Buffers.Binary;

namespace Wisp.Infrastructure.Usb;

/// <summary>
/// Read-only reference selection for the temporary template-backed exporter.
/// This does not create a standalone catalogue or certify player compatibility.
/// References are explicitly preserved locally, never learned from Wisp output.
/// </summary>
public static class PioneerTemplateLocator
{
    public static string Resolve(string targetRoot, string? configuredPath, string savedReferencePath, IEnumerable<string> candidates)
    {
        var target = Path.GetFullPath(targetRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        string Check(string path)
        {
            var full = Path.GetFullPath(path);
            if (full.StartsWith(target, StringComparison.OrdinalIgnoreCase))
                throw new PioneerTemplateRequiredException("The Pioneer reference must be outside the target USB. Preserve the rekordbox reference on this PC before formatting or exporting.");
            if (!File.Exists(full)) throw new PioneerTemplateRequiredException($"Pioneer reference not found: {full}");
            using var stream = File.OpenRead(full);
            Span<byte> header = stackalloc byte[12];
            if (stream.Length < 4096 || stream.Length % 4096 != 0 || stream.Read(header) != header.Length ||
                BinaryPrimitives.ReadUInt32LittleEndian(header[4..]) != 4096 ||
                BinaryPrimitives.ReadUInt32LittleEndian(header[8..]) < 9)
                throw new PioneerTemplateRequiredException("The saved Pioneer reference has an invalid DeviceSQL header.");
            return full;
        }

        if (!string.IsNullOrWhiteSpace(configuredPath)) return Check(configuredPath);
        if (File.Exists(savedReferencePath)) return Check(savedReferencePath);
        var available = candidates.Where(File.Exists).Select(Path.GetFullPath)
            .Where(path => !path.StartsWith(target, StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        return available.Count switch
        {
            1 => Check(available[0]),
            0 => throw new PioneerTemplateRequiredException("A preserved rekordbox database is required for this diagnostic export. Connect a separate reference USB or preserve export.pdb under Wisp/pioneer-reference in the app data folder before formatting the test USB."),
            _ => throw new PioneerTemplateRequiredException("More than one Pioneer reference was found. Set WISP_PIONEER_TEMPLATE to the exact export.pdb file to read."),
        };
    }
}
