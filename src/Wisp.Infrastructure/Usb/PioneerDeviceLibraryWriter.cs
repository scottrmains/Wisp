using System.Buffers.Binary;
using System.Runtime.InteropServices;
using System.Text;
using Wisp.Core.Cues;
using Wisp.Core.Tracks;

namespace Wisp.Infrastructure.Usb;

/// <summary>
/// Produces the conventional (pre-OneLibrary) Pioneer Device Library consumed by
/// CDJ-850-era players. It deliberately generates only the classic feature set:
/// metadata, playlists, BPM, PCOB Memory Cue/loop analysis and decoded-audio
/// overview waveforms. Wisp does not fabricate a beat grid or seek index.
/// </summary>
public sealed class PioneerDeviceLibraryWriter
{
    private const int PageSize = 4096;
    private const int PageHeaderSize = 0x28;
    private const int TableCount = 20;
    private const int NoNextPage = 0x03ffffff;

    public PioneerLibraryWriteResult Write(
        string stagingRoot,
        IReadOnlyList<PioneerExportTrack> tracks,
        IReadOnlyList<PioneerExportPlaylist> playlists)
    {
        var pioneerRoot = Path.Combine(stagingRoot, "PIONEER");
        var rekordboxRoot = Path.Combine(pioneerRoot, "rekordbox");
        Directory.CreateDirectory(rekordboxRoot);

        WriteAnalysisSidecars(stagingRoot, tracks);

        // Match rekordbox's conventional lower-case filename. FAT32 itself is
        // case-insensitive, but this avoids needless divergence from the media
        // layout observed on the CDJ-850 control USB.
        var pdbPath = Path.Combine(rekordboxRoot, "export.pdb");
        File.WriteAllBytes(pdbPath, BuildPdb(tracks, playlists));
        PioneerDeviceLibraryValidator.Validate(pdbPath, tracks, playlists);
        return new PioneerLibraryWriteResult(pdbPath, tracks.Count, playlists.Count);
    }

    /// <summary>
    /// Builds a new library by appending Wisp rows to a database that has
    /// already been accepted by a physical Pioneer player. The template is
    /// read-only; only the staged copy is changed. This deliberately uses the
    /// same page allocator as rekordbox rather than attempting to synthesize a
    /// fresh DeviceSQL allocation map.
    /// </summary>
    public PioneerLibraryWriteResult WriteFromTemplate(
        string stagingRoot,
        string templatePdbPath,
        IReadOnlyList<PioneerExportTrack> tracks,
        IReadOnlyList<PioneerExportPlaylist> playlists)
    {
        if (!File.Exists(templatePdbPath))
            throw new FileNotFoundException("A player-accepted Pioneer export.pdb template is required.", templatePdbPath);

        var editor = new PioneerTemplatePdbEditor(File.ReadAllBytes(templatePdbPath));
        var nextTrackId = editor.NextId(0, 0x48);
        var nextGenreId = editor.NextId(1, 0);
        var nextArtistId = editor.NextId(2, 4);
        var nextPlaylistId = editor.NextId(7, 12);
        var nextPlaylistOrder = editor.NextRootPlaylistOrder();
        var artistIds = new Dictionary<string, uint>(StringComparer.OrdinalIgnoreCase);
        var genreIds = new Dictionary<string, uint>(StringComparer.OrdinalIgnoreCase);
        var trackIds = new Dictionary<int, int>();
        var playlistIds = new Dictionary<int, int>();

        uint ArtistId(string value)
        {
            value = Normalise(value, "Unknown Artist");
            if (artistIds.TryGetValue(value, out var id)) return id;
            id = (uint)nextArtistId++;
            var row = BuildArtistRow(id, value);
            editor.Append(2, row, Align4(row).Length + 4, indexShiftOffset: 2);
            artistIds[value] = id;
            return id;
        }

        uint GenreId(string value)
        {
            value = Normalise(value, "Unknown Genre");
            if (genreIds.TryGetValue(value, out var id)) return id;
            id = (uint)nextGenreId++;
            var row = BuildNamedRow(id, value);
            editor.Append(1, row, Align4(row).Length);
            genreIds[value] = id;
            return id;
        }

        foreach (var source in tracks)
        {
            var deviceId = nextTrackId++;
            var track = source with { DeviceId = deviceId };
            var row = BuildTrackRow(track, ArtistId(track.Track.Artist ?? "Unknown Artist"), GenreId(track.Track.Genre ?? "Unknown Genre"));
            editor.Append(0, row, Align4(row).Length + 4, indexShiftOffset: 2);
            trackIds[source.DeviceId] = deviceId;
        }

        foreach (var source in playlists)
        {
            var deviceId = nextPlaylistId++;
            var row = BuildPlaylistRow(deviceId, source.Name, nextPlaylistOrder++);
            editor.Append(7, row, Align4(row).Length);
            playlistIds[source.DeviceId] = deviceId;

            var entryPosition = 1;
            foreach (var oldTrackId in source.TrackIds)
            {
                if (!trackIds.TryGetValue(oldTrackId, out var trackId))
                    throw new InvalidOperationException($"Pioneer playlist '{source.Name}' references an unexported track.");
                // entry_index is a one-based position WITHIN this playlist, not
                // a database-global row ID. Repeated tracks remain occurrences.
                var entry = BuildPlaylistEntryRow(entryPosition++, trackId, deviceId);
                editor.Append(8, entry, Align4(entry).Length);
            }
        }

        var pioneerRoot = Path.Combine(stagingRoot, "PIONEER", "rekordbox");
        Directory.CreateDirectory(pioneerRoot);
        WriteAnalysisSidecars(stagingRoot, tracks);
        var pdbPath = Path.Combine(pioneerRoot, "export.pdb");
        File.WriteAllBytes(pdbPath, editor.ToArray());
        return new PioneerLibraryWriteResult(pdbPath, tracks.Count, playlists.Count, trackIds, playlistIds);
    }

    private static void WriteAnalysisSidecars(string stagingRoot, IReadOnlyList<PioneerExportTrack> tracks)
    {
        PioneerAnalysisPath.RequireDistinct(tracks);
        foreach (var track in tracks)
        {
            if (string.IsNullOrWhiteSpace(track.AnalysisPath)) continue;
            var analysisFile = Path.Combine(stagingRoot, track.AnalysisPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(analysisFile)!);
            File.WriteAllBytes(analysisFile, BuildAnalysis(track.ContentPath, track.DeviceCues, track.Waveform));
        }
    }

    private static byte[] BuildPdb(IReadOnlyList<PioneerExportTrack> tracks, IReadOnlyList<PioneerExportPlaylist> playlists)
    {
        var artistIds = AllocateReferenceIds(tracks.Select(t => t.Track.Artist), "Unknown Artist");
        var genreIds = AllocateReferenceIds(tracks.Select(t => t.Track.Genre), "Unknown Genre");
        var tables = new Dictionary<int, List<byte[]>>
        {
            [0] = tracks.Select(t => BuildTrackRow(t, artistIds[Normalise(t.Track.Artist, "Unknown Artist")], genreIds[Normalise(t.Track.Genre, "Unknown Genre")])).ToList(),
            [1] = genreIds.OrderBy(x => x.Value).Select(x => BuildNamedRow(x.Value, x.Key)).ToList(),
            [2] = artistIds.OrderBy(x => x.Value).Select(x => BuildArtistRow(x.Value, x.Key)).ToList(),
            [7] = playlists.Select((p, i) => BuildPlaylistRow(p.DeviceId, p.Name, i)).ToList(),
            [8] = playlists.SelectMany(p => p.TrackIds.Select((trackId, i) => BuildPlaylistEntryRow(i + 1, trackId, p.DeviceId))).ToList(),
        };

        var chunksByType = new Dictionary<int, List<List<byte[]>>>();
        for (var type = 0; type < TableCount; type++)
        {
            tables.TryGetValue(type, out var rows);
            chunksByType[type] = PackDataPages(rows ?? []);
        }

        // A valid DeviceSQL file is not just a header plus rows. Rekordbox
        // seeds one index page and one blank allocation candidate for every
        // table. The candidate pointers are then consumed as rows are added.
        // A previous Wisp writer left every candidate as page zero; players
        // mounted the USB but rejected its catalogue as empty.
        const int seededPageCount = 1 + TableCount * 2;
        var additionalDataPages = chunksByType.Values.Sum(chunks => Math.Max(0, chunks.Count - 1));
        var bytes = new byte[(seededPageCount + additionalDataPages) * PageSize];
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(4), PageSize);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(8), TableCount);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(12), seededPageCount);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(20), 1);

        uint sequence = 1;
        for (var type = 0; type < TableCount; type++)
        {
            var indexPage = 1 + type * 2;
            var candidatePage = indexPage + 1;
            var offset = 0x1c + type * 16;
            BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(offset), (uint)type);
            BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(offset + 4), (uint)candidatePage);
            BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(offset + 8), (uint)indexPage);
            BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(offset + 12), (uint)indexPage);
            WriteIndexPage(bytes.AsSpan(indexPage * PageSize, PageSize), indexPage, type, candidatePage, NoNextPage, sequence++);
        }

        var nextUnusedPage = seededPageCount;
        for (var type = 0; type < TableCount; type++)
        {
            var tableOffset = 0x1c + type * 16;
            foreach (var rows in chunksByType[type])
            {
                var candidate = (int)BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(tableOffset + 4, 4));
                var oldLast = (int)BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(tableOffset + 12, 4));
                var following = nextUnusedPage++;
                WriteDataPage(bytes.AsSpan(candidate * PageSize, PageSize), candidate, type, following, sequence++, rows);

                // The index page has both a common next-page field and an
                // index-specific first-data-page field. On first allocation
                // both must leave the 0x03ffffff sentinel together.
                BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(oldLast * PageSize + 12, 4), (uint)candidate);
                if (oldLast == BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(tableOffset + 8, 4)))
                    BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(oldLast * PageSize + 44, 4), (uint)candidate);

                BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(tableOffset + 4, 4), (uint)following);
                BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(tableOffset + 12, 4), (uint)candidate);
            }
        }
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(12), (uint)nextUnusedPage);
        return bytes;
    }

    private static Dictionary<string, uint> AllocateReferenceIds(IEnumerable<string?> values, string fallback)
    {
        var result = new Dictionary<string, uint>(StringComparer.OrdinalIgnoreCase);
        foreach (var value in values.Select(v => Normalise(v, fallback)).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(v => v, StringComparer.OrdinalIgnoreCase))
            result[value] = (uint)result.Count + 1;
        return result;
    }

    private static List<List<byte[]>> PackDataPages(IEnumerable<byte[]> rows)
    {
        var pages = new List<List<byte[]>>();
        var current = new List<byte[]>();
        var heapBytes = 0;

        foreach (var row in rows)
        {
            var alignedLength = Align4(row).Length;
            // A page has a variable-length row directory: two bytes per row
            // plus a four-byte presence/transaction footer. Do the same
            // calculation as WriteDataPage before choosing a page boundary.
            var required = PageHeaderSize + heapBytes + alignedLength + (current.Count + 1) * 2 + 4;
            if (current.Count == 16 || required > PageSize)
            {
                if (current.Count == 0)
                    throw new InvalidOperationException("A Pioneer database row is too large to fit in a DeviceSQL page.");
                pages.Add(current);
                current = [];
                heapBytes = 0;
                required = PageHeaderSize + alignedLength + 6;
            }
            if (required > PageSize)
                throw new InvalidOperationException("A Pioneer database row is too large to fit in a DeviceSQL page.");
            current.Add(row);
            heapBytes += alignedLength;
        }

        if (current.Count > 0) pages.Add(current);
        return pages;
    }

    private static byte[] BuildTrackRow(PioneerExportTrack deviceTrack, uint artistId, uint genreId)
    {
        // A Track row has a 0x5e-byte fixed field followed by 21 two-byte
        // DeviceSQL offsets, so strings begin at 0x88.
        const int fixedLength = 0x88;
        var row = new List<byte>(new byte[fixedLength]);
        var span = row.ToArray().AsSpan();
        BinaryPrimitives.WriteUInt16LittleEndian(span, 0x24);
        BinaryPrimitives.WriteUInt32LittleEndian(span[4..], 0x000c0700);
        BinaryPrimitives.WriteUInt32LittleEndian(span[8..], 44100);
        BinaryPrimitives.WriteUInt32LittleEndian(span[16..], (uint)Math.Min(FileSize(deviceTrack.Track.FilePath), uint.MaxValue));
        BinaryPrimitives.WriteUInt32LittleEndian(span[0x14..], 0x00100000u + (uint)deviceTrack.DeviceId);
        BinaryPrimitives.WriteUInt16LittleEndian(span[0x18..], 0xae49);
        BinaryPrimitives.WriteUInt16LittleEndian(span[0x1a..], 0x03dd);
        BinaryPrimitives.WriteUInt32LittleEndian(span[0x38..], (uint)Math.Clamp(decimal.ToInt32(Math.Round(deviceTrack.Track.Bpm.GetValueOrDefault() * 100m)), 0, int.MaxValue));
        BinaryPrimitives.WriteUInt32LittleEndian(span[0x3c..], genreId);
        BinaryPrimitives.WriteUInt32LittleEndian(span[0x44..], artistId);
        BinaryPrimitives.WriteUInt32LittleEndian(span[0x48..], (uint)deviceTrack.DeviceId);
        BinaryPrimitives.WriteUInt16LittleEndian(span[0x54..], (ushort)Math.Clamp((int)Math.Round(deviceTrack.Track.Duration.TotalSeconds), 0, ushort.MaxValue));
        BinaryPrimitives.WriteUInt16LittleEndian(span[0x56..], 0x0029);
        BinaryPrimitives.WriteUInt16LittleEndian(span[0x5a..], FileType(deviceTrack.Track.FileName));
        BinaryPrimitives.WriteUInt16LittleEndian(span[0x5c..], 3);
        row = span.ToArray().ToList();

        var strings = new string?[21];
        strings[2] = "2";
        strings[3] = "2";
        strings[6] = "ON";
        strings[7] = "ON";
        strings[10] = deviceTrack.Track.AddedAt == default ? DateTime.UtcNow.ToString("yyyy-MM-dd") : deviceTrack.Track.AddedAt.ToString("yyyy-MM-dd");
        strings[12] = deviceTrack.Track.Version;
        strings[14] = deviceTrack.AnalysisPath;
        strings[15] = deviceTrack.Waveform?.AnalyzedAt.UtcDateTime.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        strings[17] = deviceTrack.Track.Title ?? Path.GetFileNameWithoutExtension(deviceTrack.Track.FileName);
        strings[19] = Path.GetFileName(deviceTrack.ContentPath);
        strings[20] = deviceTrack.ContentPath;
        for (var i = 0; i < strings.Length; i++)
        {
            var encoded = DeviceString(strings[i] ?? "");
            if ((encoded[0] & 1) == 0 && row.Count % 4 != 0)
                row.AddRange(new byte[4 - row.Count % 4]);
            if (row.Count > ushort.MaxValue) throw new InvalidOperationException("Pioneer track row exceeded its 16-bit string offset range.");
            BinaryPrimitives.WriteUInt16LittleEndian(CollectionsMarshal.AsSpan(row).Slice(0x5e + i * 2, 2), (ushort)row.Count);
            row.AddRange(encoded);
        }
        return row.ToArray();
    }

    private static byte[] BuildNamedRow(uint id, string name)
    {
        var row = new List<byte>();
        AppendLe(row, id);
        row.AddRange(DeviceString(name));
        return row.ToArray();
    }

    private static byte[] BuildArtistRow(uint id, string name)
    {
        var row = new List<byte>();
        AppendLe16(row, 0x0060);
        AppendLe16(row, 0);
        AppendLe(row, id);
        row.Add(3);
        row.Add(10);
        row.AddRange(DeviceString(name));
        return row.ToArray();
    }

    private static byte[] BuildPlaylistRow(int id, string name, int order)
    {
        var row = new List<byte>();
        AppendLe(row, 0); // root parent
        AppendLe(row, 0);
        AppendLe(row, (uint)order);
        AppendLe(row, (uint)id);
        AppendLe(row, 0); // ordinary playlist, not a folder
        row.AddRange(DeviceString(name));
        return row.ToArray();
    }

    private static byte[] BuildPlaylistEntryRow(int entryIndex, int trackId, int playlistId)
    {
        var row = new List<byte>();
        AppendLe(row, (uint)entryIndex);
        AppendLe(row, (uint)trackId);
        AppendLe(row, (uint)playlistId);
        return row.ToArray();
    }

    private static void WriteIndexPage(Span<byte> page, int pageIndex, int type, int nextPage, int firstDataPage, uint sequence)
    {
        WritePageHeader(page, pageIndex, type, nextPage, sequence, rowSlots: 0, validRows: 0, flags: 0x64, freeSize: 0, usedSize: 0);
        // A fresh Rekordbox export uses an empty index-page allocation map. It
        // is not zero-filled: each slot contains the DeviceSQL empty-entry
        // sentinel. The older writer left zeroes here, which a player can
        // interpret as real index records.
        BinaryPrimitives.WriteUInt16LittleEndian(page[32..], 0x1fff);
        BinaryPrimitives.WriteUInt16LittleEndian(page[34..], 0x1fff);
        BinaryPrimitives.WriteUInt16LittleEndian(page[36..], 0x03ec);
        // The index-specific header repeats the common page/index linkage.
        // Pioneer readers validate these fields rather than treating them as
        // padding; leaving them zero made the former prototype non-conformant.
        BinaryPrimitives.WriteUInt32LittleEndian(page[40..], (uint)pageIndex);
        BinaryPrimitives.WriteUInt32LittleEndian(page[44..], (uint)firstDataPage);
        BinaryPrimitives.WriteUInt32LittleEndian(page[48..], 0x03ffffff);
        BinaryPrimitives.WriteUInt16LittleEndian(page[56..], 0);
        BinaryPrimitives.WriteUInt16LittleEndian(page[58..], 0x1fff);
        for (var offset = 60; offset < PageSize; offset += 4)
            BinaryPrimitives.WriteUInt32LittleEndian(page[offset..], 0x1ffffff8);
    }

    private static void WriteDataPage(Span<byte> page, int pageIndex, int type, int nextPage, uint sequence, IReadOnlyList<byte[]> rows)
    {
        if (rows.Count > 16) throw new ArgumentOutOfRangeException(nameof(rows));
        var alignedRows = rows.Select(Align4).ToList();
        var used = alignedRows.Sum(r => r.Length);
        // The row directory grows by exactly the offsets allocated for its
        // active group plus the presence/transaction masks. A partly filled
        // group is not padded to sixteen offsets (an eight-row Rekordbox page
        // reserves 20 bytes, not 36).
        var rowDirectorySize = rows.Count * 2 + 4;
        if (PageHeaderSize + used + rowDirectorySize > PageSize) throw new InvalidOperationException($"Pioneer {type} table row group exceeds a database page.");
        WritePageHeader(page, pageIndex, type, nextPage, sequence, rows.Count, rows.Count, 0x24, PageSize - PageHeaderSize - used - rowDirectorySize, used);

        var offset = PageHeaderSize;
        for (var i = 0; i < rows.Count; i++)
        {
            rows[i].CopyTo(page[offset..]);
            if (type is 0 or 2 or 3)
                BinaryPrimitives.WriteUInt16LittleEndian(page.Slice(offset + 2, 2), (ushort)(0x20 * i));
            var rowOffsetSlot = PageSize - 4 - 2 * (i + 1);
            BinaryPrimitives.WriteUInt16LittleEndian(page[rowOffsetSlot..], (ushort)(offset - 40));
            offset += alignedRows[i].Length;
        }
        BinaryPrimitives.WriteUInt16LittleEndian(page[(PageSize - 4)..], (ushort)((1 << rows.Count) - 1));
        BinaryPrimitives.WriteUInt16LittleEndian(page[(PageSize - 2)..], (ushort)((1 << rows.Count) - 1));
        BinaryPrimitives.WriteUInt16LittleEndian(page[32..], (ushort)rows.Count);
        BinaryPrimitives.WriteUInt16LittleEndian(page[34..], 0);
    }

    private static void WritePageHeader(Span<byte> page, int pageIndex, int type, int nextPage, uint sequence, int rowSlots, int validRows, byte flags, int freeSize, int usedSize)
    {
        BinaryPrimitives.WriteUInt32LittleEndian(page[4..], (uint)pageIndex);
        BinaryPrimitives.WriteUInt32LittleEndian(page[8..], (uint)type);
        BinaryPrimitives.WriteUInt32LittleEndian(page[12..], (uint)nextPage);
        BinaryPrimitives.WriteUInt32LittleEndian(page[16..], sequence);
        var count = rowSlots | (validRows << 13);
        page[24] = (byte)count;
        page[25] = (byte)(count >> 8);
        page[26] = (byte)(count >> 16);
        page[27] = flags;
        BinaryPrimitives.WriteUInt16LittleEndian(page[28..], (ushort)freeSize);
        BinaryPrimitives.WriteUInt16LittleEndian(page[30..], (ushort)usedSize);
    }

    private static byte[] BuildAnalysis(string contentPath, IReadOnlyList<DeviceCue> cues, PioneerWaveform? waveform)
    {
        var file = new List<byte>();
        file.AddRange("PMAI"u8.ToArray());
        AppendBe(file, 28);
        AppendBe(file, 0); // patched after sections are appended
        // Fixed PMAI fields observed on the rekordbox reference export.
        AppendBe(file, 1);
        AppendBe(file, 0x10000);
        AppendBe(file, 0x10000);
        AppendBe(file, 0);
        var pathBytes = Encoding.BigEndianUnicode.GetBytes(contentPath + "\0");
        AppendTag(file, "PPTH", 16, body =>
        {
            AppendBe(body, pathBytes.Length);
            body.AddRange(pathBytes);
        });
        if (waveform is not null)
        {
            AppendWaveform(file, "PWAV", waveform.Preview, 400);
            AppendWaveform(file, "PWV2", waveform.Tiny, 100);
        }
        AppendCueList(file, 1, []); // canonical empty Hot Cue section
        AppendCueList(file, 0, cues.OrderBy(c => c.StartSeconds).ToList());
        WriteBeAt(file, 8, file.Count);
        return file.ToArray();
    }

    private static void AppendWaveform(List<byte> file, string tag, byte[] data, int columns)
    {
        if (data.Length != columns) throw new InvalidOperationException($"{tag} requires {columns} waveform columns.");
        AppendTag(file, tag, 20, body =>
        {
            AppendBe(body, data.Length);
            AppendBe(body, 0x10000);
            body.AddRange(data);
        });
    }

    private static void AppendCueList(List<byte> file, int type, IReadOnlyList<DeviceCue> cues)
    {
        var tag = new List<byte>();
        tag.AddRange("PCOB"u8.ToArray());
        AppendBe(tag, 24);
        AppendBe(tag, 0); // patched below
        AppendBe(tag, type);
        AppendBe16(tag, 0);
        AppendBe16(tag, (ushort)cues.Count);
        AppendBe(tag, type == 0 && cues.Count > 0 ? 1u : uint.MaxValue);
        for (var i = 0; i < cues.Count; i++) AppendCuePoint(tag, cues[i], i, cues.Count);
        WriteBeAt(tag, 8, tag.Count);
        file.AddRange(tag);
    }

    private static void AppendCuePoint(List<byte> output, DeviceCue cue, int index, int total)
    {
        output.AddRange("PCPT"u8.ToArray());
        AppendBe(output, 28);
        AppendBe(output, 56);
        AppendBe(output, 0); // memory cue rather than hot cue
        AppendBe(output, 0); // not an active loop
        AppendBe(output, 0x00010000);
        AppendBe16(output, index == 0 ? ushort.MaxValue : (ushort)(index - 1));
        AppendBe16(output, index == total - 1 ? ushort.MaxValue : (ushort)(index + 1));
        // PCPT offset 0x1c is ONE byte of type, followed by three bytes
        // 00 03 e8. Writing two uint32s here shifts both timestamps and
        // emits 60 bytes despite declaring 56, corrupting subsequent cues.
        // Layout: Deep-Symmetry/crate-digger rekordbox_anlz.ksy cue_entry;
        // cross-checked against the September 2026 rekordbox USB reference.
        output.Add(cue.Kind == DeviceCueKind.Loop ? (byte)2 : (byte)1);
        output.AddRange(new byte[] { 0, 3, 0xe8 });
        AppendBe(output, ToMilliseconds(cue.StartSeconds));
        AppendBe(output, cue.Kind == DeviceCueKind.Loop && cue.EndSeconds is { } end ? ToMilliseconds(end) : uint.MaxValue);
        output.AddRange(new byte[16]);
    }

    private static void AppendTag(List<byte> output, string fourCc, int headerLength, Action<List<byte>> body)
    {
        var tag = new List<byte>();
        tag.AddRange(Encoding.ASCII.GetBytes(fourCc));
        AppendBe(tag, headerLength);
        AppendBe(tag, 0);
        body(tag);
        WriteBeAt(tag, 8, tag.Count);
        output.AddRange(tag);
    }

    private static byte[] DeviceString(string value)
    {
        var ascii = Encoding.ASCII.GetBytes(value.Normalize(NormalizationForm.FormKC).Select(c => c <= 0x7f ? c : '?').ToArray());
        if (ascii.Length <= 126)
        {
            var result = new byte[ascii.Length + 1];
            result[0] = (byte)((ascii.Length + 1) * 2 + 1);
            ascii.CopyTo(result, 1);
            return result;
        }
        var longString = new List<byte> { 0x40 };
        AppendLe16(longString, (ushort)(ascii.Length + 4));
        longString.Add(0);
        longString.AddRange(ascii);
        return longString.ToArray();
    }

    private static byte[] Align4(byte[] bytes)
    {
        var length = (bytes.Length + 3) & ~3;
        return length == bytes.Length ? bytes : bytes.Concat(new byte[length - bytes.Length]).ToArray();
    }

    private static string Normalise(string? value, string fallback) => string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
    private static ushort FileType(string fileName) => Path.GetExtension(fileName).ToLowerInvariant() switch
    {
        ".mp3" => 0x01,
        ".m4a" or ".aac" => 0x04,
        ".wav" => 0x0b,
        ".aiff" or ".aif" => 0x0c,
        _ => 0,
    };
    private static long FileSize(string path) => File.Exists(path) ? new FileInfo(path).Length : 0;
    private static uint ToMilliseconds(double seconds) => (uint)Math.Clamp(Math.Round(seconds * 1000), 0, uint.MaxValue - 1d);
    private static void AppendLe(List<byte> output, uint value) { var b = new byte[4]; BinaryPrimitives.WriteUInt32LittleEndian(b, value); output.AddRange(b); }
    private static void AppendLe16(List<byte> output, ushort value) { var b = new byte[2]; BinaryPrimitives.WriteUInt16LittleEndian(b, value); output.AddRange(b); }
    private static void AppendBe(List<byte> output, int value) => AppendBe(output, unchecked((uint)value));
    private static void AppendBe(List<byte> output, uint value) { var b = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(b, value); output.AddRange(b); }
    private static void AppendBe16(List<byte> output, ushort value) { var b = new byte[2]; BinaryPrimitives.WriteUInt16BigEndian(b, value); output.AddRange(b); }
    private static void WriteBeAt(List<byte> output, int offset, int value) => WriteBeAt(output, offset, unchecked((uint)value));
    private static void WriteBeAt(List<byte> output, int offset, uint value) => BinaryPrimitives.WriteUInt32BigEndian(CollectionsMarshal.AsSpan(output).Slice(offset, 4), value);

}

public sealed record PioneerExportTrack(int DeviceId, string ContentPath, string AnalysisPath, Track Track, IReadOnlyList<DeviceCue> DeviceCues,
    PioneerWaveform? Waveform = null);
public sealed record PioneerExportPlaylist(int DeviceId, string Name, IReadOnlyList<int> TrackIds);
public sealed record PioneerLibraryWriteResult(
    string PdbPath,
    int TrackCount,
    int PlaylistCount,
    IReadOnlyDictionary<int, int>? TrackIdMap = null,
    IReadOnlyDictionary<int, int>? PlaylistIdMap = null);
