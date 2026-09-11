using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using Wisp.Api.Library;

namespace Wisp.Api;

/// Chromium/WebView2's native representation of DataTransfer custom MIME data.
/// See Chromium ui/base/clipboard/custom_data_helper.cc and base/pickle.cc:
/// payload-size header, entry count, then length-prefixed UTF-16 strings padded
/// to 4 bytes. This is NOT a DownloadURL or a path masquerading as a browser File.
public static class TrackDragPayload
{
    public const string MimeType = "application/x-wisp-track-ids";
    public static byte[] Create(IReadOnlyList<Guid> ids)
    {
        if (ids.Count is < 1 or > LibraryFileDrag.MaxTracks)
            throw new ArgumentException("Invalid track drag selection.");
        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream, Encoding.Unicode, leaveOpen: true);
        writer.Write(0); // Patched payload size (excluding this 4-byte header).
        writer.Write(1u);
        WriteString(MimeType);
        WriteString(JsonSerializer.Serialize(ids));
        var bytes = stream.ToArray();
        BinaryPrimitives.WriteInt32LittleEndian(bytes, bytes.Length - 4);
        return bytes;

        void WriteString(string value)
        {
            writer.Write(value.Length); // UTF-16 code units, not bytes.
            writer.Write(Encoding.Unicode.GetBytes(value));
            while (stream.Position % 4 != 0) writer.Write((byte)0);
        }
    }
}
