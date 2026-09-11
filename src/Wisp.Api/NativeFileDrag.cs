using System.Buffers.Binary;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Runtime.Versioning;
using System.Text;
using Serilog;

namespace Wisp.Api;

/// Standard Unicode CF_HDROP: DROPFILES header followed by a double-NUL-terminated list.
public static class FileDropPayload
{
    public static byte[] Create(IReadOnlyList<string> paths)
    {
        if (paths.Count == 0 || paths.Any(p => string.IsNullOrEmpty(p) || p.Contains('\0')))
            throw new ArgumentException("A file drop needs nonempty paths without NUL characters.");
        var names = Encoding.Unicode.GetBytes(string.Join('\0', paths) + "\0\0");
        var result = new byte[20 + names.Length];
        BinaryPrimitives.WriteInt32LittleEndian(result, 20); // pFiles
        BinaryPrimitives.WriteInt32LittleEndian(result.AsSpan(16), 1); // fWide
        names.CopyTo(result, 20);
        return result;
    }
}

/// Offers active audio files plus optional WISP IDs in one OLE drag. Copy-only:
/// neither a drop target nor keyboard modifiers can request source-file removal.
[SupportedOSPlatform("windows")]
public static class NativeFileDrag
{
    public sealed record Result(bool DropAccepted, int FileCount, string? Reason = null);

    public static Result Start(string[] paths, IReadOnlyList<Guid>? trackIds = null)
    {
        if (Thread.CurrentThread.GetApartmentState() != ApartmentState.STA)
            throw new InvalidOperationException("File dragging must run on WISP's desktop UI thread.");
        // If the user released while the bridge resolved files, don't start a
        // phantom drop at the current cursor position.
        if ((GetAsyncKeyState(1) & 0x8000) == 0)
        {
            Log.Information("File drag: mouse released before native drag started ({FileCount} files)", paths.Length);
            return new(false, paths.Length, "released-before-start");
        }
        Marshal.ThrowExceptionForHR(OleInitialize(IntPtr.Zero));
        try
        {
            var data = new FileDataObject(paths.Length > 0 ? FileDropPayload.Create(paths) : null,
                trackIds is null ? null : TrackDragPayload.Create(trackIds));
            var source = new DropSource();
            Log.Information("File drag: entering Windows OLE loop with {FileCount} files", paths.Length);
            var hr = DoDragDrop(data, source, 1 /* DROPEFFECT_COPY */, out var effect);
            GC.KeepAlive(data);
            GC.KeepAlive(source);
            Marshal.ThrowExceptionForHR(hr);
            Log.Information("File drag: OLE returned {HResult:X8}, effect {Effect}, {FileCount} files", hr, effect, paths.Length);
            return new(hr == 0x40100 && (effect & 1) != 0, paths.Length);
        }
        finally { OleUninitialize(); }
    }

    [ComVisible(true), Guid("00000121-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IDropSource
    {
        [PreserveSig] int QueryContinueDrag([MarshalAs(UnmanagedType.Bool)] bool escapePressed, uint keyState);
        [PreserveSig] int GiveFeedback(uint effect);
    }

    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    public sealed class DropSource : IDropSource
    {
        public int QueryContinueDrag(bool escapePressed, uint keyState) => escapePressed ? 0x40101 : (keyState & 1) == 0 ? 0x40100 : 0;
        public int GiveFeedback(uint effect) => 0x40102; // DRAGDROP_S_USEDEFAULTCURSORS
    }

    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    public sealed class FileDataObject : IDataObject
    {
        private readonly Dictionary<short, byte[]> _payloads = new();
        public FileDataObject(byte[]? files, byte[]? tracks = null)
        {
            if (files is not null) _payloads.Add(15 /* CF_HDROP */, files);
            if (tracks is not null)
            {
                // Both names support current Chromium and older WebView2 runtimes.
                foreach (var name in new[] { "Chromium Web Custom MIME Data Format", "Web Custom MIME Data Format" })
                {
                    var format = RegisterClipboardFormat(name);
                    if (format == 0) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                    _payloads.Add(unchecked((short)format), tracks);
                }
            }
            if (_payloads.Count == 0) throw new ArgumentException("A drag must offer tracks or files.");
        }
        private static FORMATETC Format(short id) => new() { cfFormat = id, dwAspect = DVASPECT.DVASPECT_CONTENT, lindex = -1, tymed = TYMED.TYMED_HGLOBAL };
        public int QueryGetData(ref FORMATETC f) => _payloads.ContainsKey(f.cfFormat) && f.dwAspect == DVASPECT.DVASPECT_CONTENT
            && f.lindex == -1 && (f.tymed & TYMED.TYMED_HGLOBAL) != 0 ? 0 : unchecked((int)0x80040064);
        public void GetData(ref FORMATETC format, out STGMEDIUM medium)
        {
            Marshal.ThrowExceptionForHR(QueryGetData(ref format));
            var payload = _payloads[format.cfFormat];
            var handle = GlobalAlloc(0x42 /* MOVEABLE | ZEROINIT */, (nuint)payload.Length);
            if (handle == IntPtr.Zero) throw new OutOfMemoryException();
            var pointer = GlobalLock(handle);
            if (pointer == IntPtr.Zero) { GlobalFree(handle); throw new OutOfMemoryException(); }
            try { Marshal.Copy(payload, 0, pointer, payload.Length); }
            catch { GlobalUnlock(handle); GlobalFree(handle); throw; }
            GlobalUnlock(handle);
            // Ownership transfers to the target, which calls ReleaseStgMedium.
            medium = new STGMEDIUM { tymed = TYMED.TYMED_HGLOBAL, unionmember = handle, pUnkForRelease = null };
        }
        public IEnumFORMATETC EnumFormatEtc(DATADIR direction)
        {
            if (direction != DATADIR.DATADIR_GET) throw new COMException("Read only", unchecked((int)0x80004001));
            var formats = _payloads.Keys.Select(Format).ToArray();
            Marshal.ThrowExceptionForHR(SHCreateStdEnumFmtEtc((uint)formats.Length, formats, out var enumerator));
            return enumerator;
        }
        public void GetDataHere(ref FORMATETC format, ref STGMEDIUM medium) => throw new COMException("Use GetData", unchecked((int)0x80040069));
        public int GetCanonicalFormatEtc(ref FORMATETC input, out FORMATETC output) { output = input; output.ptd = IntPtr.Zero; return 0x40130; }
        public void SetData(ref FORMATETC format, ref STGMEDIUM medium, bool release) => throw new COMException("Read only", unchecked((int)0x80004001));
        public int DAdvise(ref FORMATETC format, ADVF flags, IAdviseSink sink, out int connection) { connection = 0; return unchecked((int)0x80040003); }
        public void DUnadvise(int connection) => throw new COMException("No advisory connection", unchecked((int)0x80040003));
        public int EnumDAdvise(out IEnumSTATDATA enumerator) { enumerator = null!; return unchecked((int)0x80040003); }
    }

    [DllImport("ole32.dll")] private static extern int OleInitialize(IntPtr reserved);
    [DllImport("ole32.dll")] private static extern void OleUninitialize();
    [DllImport("ole32.dll")] private static extern int DoDragDrop([MarshalAs(UnmanagedType.Interface)] IDataObject data, [MarshalAs(UnmanagedType.Interface)] IDropSource source, uint allowedEffects, out uint effect);
    [DllImport("shell32.dll")] private static extern int SHCreateStdEnumFmtEtc(uint count, [In] FORMATETC[] formats, out IEnumFORMATETC enumerator);
    [DllImport("kernel32.dll")] private static extern IntPtr GlobalAlloc(uint flags, nuint bytes);
    [DllImport("kernel32.dll")] private static extern IntPtr GlobalLock(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern bool GlobalUnlock(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern IntPtr GlobalFree(IntPtr handle);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "RegisterClipboardFormatW", SetLastError = true)]
    private static extern uint RegisterClipboardFormat(string name);
}
