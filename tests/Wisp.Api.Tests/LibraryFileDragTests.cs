using System.Buffers.Binary;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Wisp.Api.Library;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Tests;

public sealed class LibraryFileDragTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wisp-drag-" + Guid.NewGuid().ToString("N"));
    private readonly SqliteConnection _connection = new("Data Source=:memory:");
    private readonly WispDbContext _db;
    private readonly Guid _first = Guid.NewGuid(), _second = Guid.NewGuid();
    private string First => Path.Combine(_root, "Olive — café 日本語.aiff");
    private string Second => Path.Combine(_root, "Another track.mp3");

    public LibraryFileDragTests()
    {
        Directory.CreateDirectory(_root);
        File.WriteAllBytes(First, [1, 2]); File.WriteAllBytes(Second, [3, 4]);
        _connection.Open();
        _db = new WispDbContext(new DbContextOptionsBuilder<WispDbContext>().UseSqlite(_connection).Options);
        _db.Database.EnsureCreated();
        _db.Tracks.AddRange(new Track { Id = _first, FilePath = First, FileName = Path.GetFileName(First) },
            new Track { Id = _second, FilePath = Second, FileName = Path.GetFileName(Second), IsUnavailable = true });
        _db.SaveChanges();
    }

    [Fact]
    public void Resolves_ids_in_selection_order_and_never_changes_source_files()
    {
        Assert.Equal(new[] { Second, First }, new LibraryFileDrag(_db).Resolve([_second, _first, _second]));
        Assert.Equal(new byte[] { 1, 2 }, File.ReadAllBytes(First));
        Assert.Equal(2, _db.Tracks.Count());
    }

    [Fact]
    public void Missing_deleted_or_oversized_selections_are_not_silently_partially_dragged()
    {
        var resolver = new LibraryFileDrag(_db);
        Assert.Throws<ArgumentException>(() => resolver.Resolve([]));
        Assert.Throws<ArgumentException>(() => resolver.Resolve(Enumerable.Repeat(_first, LibraryFileDrag.MaxTracks + 1).ToArray()));
        Assert.Throws<InvalidOperationException>(() => resolver.Resolve([Guid.NewGuid()]));
        File.Delete(Second);
        Assert.Contains("No files were sent", Assert.Throws<InvalidOperationException>(() => resolver.Resolve([_first, _second])).Message);
    }

    [Fact]
    public void Drop_payload_is_a_unicode_file_list_not_browser_urls()
    {
        var bytes = FileDropPayload.Create([First, Second]);
        Assert.Equal(20, BinaryPrimitives.ReadInt32LittleEndian(bytes));
        Assert.Equal(1, BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan(16)));
        Assert.Equal(First + '\0' + Second + "\0\0", Encoding.Unicode.GetString(bytes, 20, bytes.Length - 20));
        Assert.Throws<ArgumentException>(() => FileDropPayload.Create(["bad\0path"]));
    }

    [Fact]
    public void Unified_selection_preserves_playlist_occurrences_but_deduplicates_external_files()
    {
        var selection = new LibraryFileDrag(_db).ResolveSelection([_second, _first, _second], true);
        Assert.Equal(new[] { _second, _first, _second }, selection.TrackIds);
        Assert.Equal(new[] { Second, First }, selection.Paths);
        Assert.Equal(0, selection.MissingCount);
        File.Delete(Second);
        selection = new LibraryFileDrag(_db).ResolveSelection([_second, _first, _second], true);
        Assert.Equal(new[] { _second, _first, _second }, selection.TrackIds);
        Assert.Empty(selection.Paths); // Never export just the remaining subset.
        Assert.Equal(1, selection.MissingCount);
        Assert.Throws<InvalidOperationException>(() => new LibraryFileDrag(_db).ResolveSelection([Guid.NewGuid()], true));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(1205)]
    [InlineData(20000)]
    public void Chromium_pickle_preserves_every_id_and_correct_string_padding(int count)
    {
        var ids = Enumerable.Range(0, count).Select(_ => Guid.NewGuid()).ToArray();
        Assert.Equal(ids, ReadTrackPayload(TrackDragPayload.Create(ids)));
        Assert.Throws<ArgumentException>(() => TrackDragPayload.Create([]));
        Assert.Throws<ArgumentException>(() => TrackDragPayload.Create(new Guid[20001]));
    }

    // Independent reader for Chromium's base::Pickle format, not a production
    // encoder/decoder round trip. Validates the sizes, UTF-16 units and padding.
    private static Guid[] ReadTrackPayload(byte[] bytes)
    {
        using var reader = new BinaryReader(new MemoryStream(bytes), Encoding.Unicode);
        Assert.Equal(bytes.Length - 4, reader.ReadInt32());
        Assert.Equal(1u, reader.ReadUInt32());
        string ReadString()
        {
            var length = reader.ReadInt32();
            var result = Encoding.Unicode.GetString(reader.ReadBytes(length * 2));
            while (reader.BaseStream.Position % 4 != 0) Assert.Equal(0, reader.ReadByte());
            return result;
        }
        Assert.Equal("application/x-wisp-track-ids", ReadString());
        var ids = JsonSerializer.Deserialize<Guid[]>(ReadString())!;
        Assert.Equal(bytes.Length, reader.BaseStream.Position);
        return ids;
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Same_windows_data_object_exposes_webview_track_ids_and_optional_real_files(bool withFiles)
    {
        if (!OperatingSystem.IsWindows()) return;
        var tracks = TrackDragPayload.Create([_second, _first, _second]);
        var data = new NativeFileDrag.FileDataObject(withFiles ? FileDropPayload.Create([Second, First]) : null, tracks);
        var enumerator = data.EnumFormatEtc(DATADIR.DATADIR_GET);
        var formats = new FORMATETC[withFiles ? 3 : 2];
        Assert.Equal(0, enumerator.Next(formats.Length, formats, [0]));
        Assert.Equal(withFiles, formats.Any(f => f.cfFormat == 15));
        var formatNames = new List<string>();
        foreach (var formatEntry in formats)
        {
            var format = formatEntry;
            Assert.Equal(0, data.QueryGetData(ref format));
            if (format.cfFormat != 15)
            {
                var name = new StringBuilder(256);
                Assert.True(GetClipboardFormatName(unchecked((ushort)format.cfFormat), name, name.Capacity) > 0);
                formatNames.Add(name.ToString());
            }
            // OLE clients can query/retrieve more than once. Each receives its
            // own HGLOBAL ownership; reading one format cannot consume another.
            for (var read = 0; read < 2; read++)
            {
                data.GetData(ref format, out var medium);
                try
                {
                    if (format.cfFormat == 15)
                    {
                        Assert.Equal(2u, DragQueryFile(medium.unionmember, uint.MaxValue, null, 0));
                        var path = new StringBuilder(32768);
                        DragQueryFile(medium.unionmember, 0, path, (uint)path.Capacity);
                        Assert.Equal(Second, path.ToString());
                    }
                    else
                    {
                        var pointer = GlobalLock(medium.unionmember);
                        Assert.NotEqual(IntPtr.Zero, pointer);
                        try
                        {
                            var bytes = new byte[tracks.Length];
                            Marshal.Copy(pointer, bytes, 0, bytes.Length);
                            Assert.Equal(new[] { _second, _first, _second }, ReadTrackPayload(bytes));
                        }
                        finally { GlobalUnlock(medium.unionmember); }
                    }
                }
                finally { ReleaseStgMedium(ref medium); }
            }
        }
        Assert.Contains("Chromium Web Custom MIME Data Format", formatNames);
        Assert.Contains("Web Custom MIME Data Format", formatNames);
        var unsupported = new FORMATETC { cfFormat = 13, dwAspect = DVASPECT.DVASPECT_CONTENT, lindex = -1, tymed = TYMED.TYMED_HGLOBAL };
        Assert.NotEqual(0, data.QueryGetData(ref unsupported)); // No text/URL/download fallback.
        Assert.Throws<COMException>(() => { if (OperatingSystem.IsWindows()) data.GetData(ref unsupported, out _); });
        Assert.Throws<ArgumentException>(() => { if (OperatingSystem.IsWindows()) _ = new NativeFileDrag.FileDataObject(null); });
    }

    [Fact]
    public void Windows_shell_can_read_every_file_from_the_native_data_object()
    {
        if (!OperatingSystem.IsWindows()) return; // Native interop is exercised by Windows CI.
        var data = new NativeFileDrag.FileDataObject(FileDropPayload.Create([First, Second]));
        var enumerator = data.EnumFormatEtc(DATADIR.DATADIR_GET);
        var formats = new FORMATETC[1];
        Assert.Equal(0, enumerator.Next(1, formats, [0]));
        var format = formats[0];
        Assert.Equal(15, format.cfFormat);
        Assert.Equal(0, data.QueryGetData(ref format));
        data.GetData(ref format, out var medium);
        try
        {
            Assert.Equal(2u, DragQueryFile(medium.unionmember, uint.MaxValue, null, 0));
            foreach (var (expected, index) in new[] { (First, 0u), (Second, 1u) })
            {
                var text = new StringBuilder(32768);
                DragQueryFile(medium.unionmember, index, text, (uint)text.Capacity);
                Assert.Equal(expected, text.ToString());
            }
            // Verify the managed object actually exposes the COM IDataObject IID.
            var pointer = Marshal.GetComInterfaceForObject(data, typeof(IDataObject));
            Assert.NotEqual(IntPtr.Zero, pointer);
            Marshal.Release(pointer);
        }
        finally { ReleaseStgMedium(ref medium); }
        var source = new NativeFileDrag.DropSource();
        Assert.Equal(0, source.QueryContinueDrag(false, 1));
        Assert.Equal(0x40100, source.QueryContinueDrag(false, 0));
        Assert.Equal(0x40101, source.QueryContinueDrag(true, 1));
        Assert.Equal(0x40102, source.GiveFeedback(1));
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, EntryPoint = "DragQueryFileW")]
    private static extern uint DragQueryFile(IntPtr drop, uint index, StringBuilder? path, uint size);
    [DllImport("ole32.dll")] private static extern void ReleaseStgMedium(ref STGMEDIUM medium);
    [DllImport("kernel32.dll")] private static extern IntPtr GlobalLock(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern bool GlobalUnlock(IntPtr handle);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetClipboardFormatNameW")]
    private static extern int GetClipboardFormatName(uint format, StringBuilder name, int capacity);

    public void Dispose() { _db.Dispose(); _connection.Dispose(); Directory.Delete(_root, true); }
}
