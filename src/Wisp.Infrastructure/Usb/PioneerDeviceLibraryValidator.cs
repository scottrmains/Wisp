using System.Buffers.Binary;
using System.Text;
using Wisp.Core.Cues;

namespace Wisp.Infrastructure.Usb;

/// <summary>
/// Structural validation performed before a staged library is allowed to replace
/// anything on a USB. It is intentionally strict about the subset Wisp writes;
/// this catches a broken page/index or cue-list length before the user ejects a
/// device, even though physical-player testing remains the final acceptance step.
/// </summary>
public static class PioneerDeviceLibraryValidator
{
    private const int PageSize = 4096;

    public static void Validate(
        string pdbPath,
        IReadOnlyList<PioneerExportTrack> tracks,
        IReadOnlyList<PioneerExportPlaylist> playlists,
        bool allowAdditionalRows = false,
        bool validateFreshPageLayout = true)
    {
        var bytes = File.ReadAllBytes(pdbPath);
        if (bytes.Length < PageSize || ReadLe32(bytes, 4) != PageSize)
            throw new InvalidOperationException("Generated Pioneer database has an invalid page header.");

        var tables = ReadLe32(bytes, 8);
        if (tables < 9 || bytes.Length % PageSize != 0)
            throw new InvalidOperationException("Generated Pioneer database is truncated or missing required tables.");

        var foundTrackIds = ReadRows(bytes, 0).Select(r => ReadLe32(bytes, r + 0x48)).ToHashSet();
        var expectedTrackIds = tracks.Select(t => (uint)t.DeviceId).ToHashSet();
        if (allowAdditionalRows ? !expectedTrackIds.IsSubsetOf(foundTrackIds) : !expectedTrackIds.SetEquals(foundTrackIds))
            throw new InvalidOperationException("Generated Pioneer database did not retain every exported track ID.");

        var playlistRows = ReadRows(bytes, 7);
        var foundPlaylistIds = playlistRows.Select(r => ReadLe32(bytes, r + 12)).ToHashSet();
        var expectedPlaylistIds = playlists.Select(p => (uint)p.DeviceId).ToHashSet();
        if (allowAdditionalRows ? !expectedPlaylistIds.IsSubsetOf(foundPlaylistIds) : !expectedPlaylistIds.SetEquals(foundPlaylistIds))
            throw new InvalidOperationException("Generated Pioneer database did not retain every exported playlist.");

        // A template can be a valid older rekordbox export whose index-page
        // allocation map differs from Wisp's fresh-development fixture. Do
        // not reject that player-accepted structure; row and playlist checks
        // above still prove that the newly appended records are reachable.
        if (validateFreshPageLayout) ValidatePioneerPageLayout(bytes, tables);
        ValidateTrackRows(bytes);

        var entries = ReadRows(bytes, 8)
            .Select(r => (TrackId: ReadLe32(bytes, r + 4), PlaylistId: ReadLe32(bytes, r + 8)))
            .ToList();
        foreach (var playlist in playlists)
        {
            var actual = entries.Where(e => e.PlaylistId == playlist.DeviceId).Select(e => e.TrackId).ToList();
            if (!actual.SequenceEqual(playlist.TrackIds.Select(id => (uint)id)))
                throw new InvalidOperationException($"Generated Pioneer playlist '{playlist.Name}' has the wrong track order.");
        }

        foreach (var track in tracks)
        {
            if (string.IsNullOrWhiteSpace(track.AnalysisPath)) continue;
            var analysis = Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(Path.GetDirectoryName(pdbPath))!)!, track.AnalysisPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
            ValidateAnalysis(analysis, track.ContentPath, track.DeviceCues);
        }
    }

    /// <summary>
    /// Checks format invariants from the published DeviceSQL analysis rather
    /// than merely re-reading Wisp's own rows. This deliberately covers the
    /// index-page mirror fields and fixed row-directory reservation that the
    /// CDJ validates while opening an export.
    /// </summary>
    private static void ValidatePioneerPageLayout(byte[] bytes, uint tableCount)
    {
        for (var type = 0; type < tableCount; type++)
        {
            var tableOffset = 0x1c + type * 16;
            var indexPage = (int)ReadLe32(bytes, tableOffset + 8);
            var lastPage = (int)ReadLe32(bytes, tableOffset + 12);
            var candidatePage = ReadLe32(bytes, tableOffset + 4);
            if (indexPage <= 0 || indexPage * PageSize >= bytes.Length)
                throw new InvalidOperationException($"Pioneer table {type} has no valid index page.");
            var offset = indexPage * PageSize;
            if (bytes[offset + 27] != 0x64 || ReadLe32(bytes, offset + 4) != (uint)indexPage)
                throw new InvalidOperationException($"Pioneer table {type} index-page header is invalid.");
            var firstDataPage = ReadLe32(bytes, offset + 44);
            if (ReadLe32(bytes, offset + 40) != (uint)indexPage ||
                ReadLe32(bytes, offset + 48) != 0x03ffffff)
                throw new InvalidOperationException($"Pioneer table {type} index-page linkage is invalid.");
            if (lastPage == indexPage)
            {
                if (firstDataPage != 0x03ffffff || ReadLe32(bytes, offset + 12) != candidatePage)
                    throw new InvalidOperationException($"Pioneer empty table {type} does not retain its DeviceSQL sentinel.");
            }
            else if (firstDataPage <= 0 || firstDataPage * PageSize >= bytes.Length || ReadLe32(bytes, offset + 12) != firstDataPage)
            {
                throw new InvalidOperationException($"Pioneer table {type} first data-page link is invalid.");
            }
            if (candidatePage == 0)
                throw new InvalidOperationException($"Pioneer table {type} has no reserved allocation candidate.");
            if (BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(offset + 32, 2)) != 0x1fff ||
                BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(offset + 34, 2)) != 0x1fff ||
                BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(offset + 60, 4)) != 0x1ffffff8)
                throw new InvalidOperationException($"Pioneer table {type} index-page allocation map is invalid.");
        }
    }

    private static void ValidateTrackRows(byte[] bytes)
    {
        foreach (var row in ReadRows(bytes, 0))
        {
            if (ReadLe32(bytes, row + 0x48) == 0 ||
                BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(row + 0x5c, 2)) != 3)
                throw new InvalidOperationException("Pioneer Track row fixed fields are invalid.");
            for (var i = 0; i < 21; i++)
            {
                var offset = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(row + 0x5e + i * 2, 2));
                if (offset < 0x88 || row + offset >= bytes.Length)
                    throw new InvalidOperationException("Pioneer Track row contains an invalid DeviceSQL string offset.");
            }
        }
    }

    private static IEnumerable<int> ReadRows(byte[] bytes, int wantedType)
    {
        var tableOffset = 0x1c + wantedType * 16;
        var firstPage = (int)ReadLe32(bytes, tableOffset + 8);
        var lastPage = (int)ReadLe32(bytes, tableOffset + 12);
        if (firstPage <= 0 || lastPage < firstPage) throw new InvalidOperationException($"Pioneer table {wantedType} is invalid.");
        var page = firstPage;
        var visited = new HashSet<int>();
        while (page != lastPage)
        {
            if (!visited.Add(page) || page <= 0 || page * PageSize >= bytes.Length)
                throw new InvalidOperationException($"Pioneer table {wantedType} has an invalid page chain.");
            var offset = page * PageSize;
            if (ReadLe32(bytes, offset + 8) != wantedType) throw new InvalidOperationException("Pioneer page type mismatch.");
            var next = (int)ReadLe32(bytes, offset + 12);
            if ((bytes[offset + 27] & 0x40) == 0)
                foreach (var row in ReadRowsFromPage(bytes, offset)) yield return row;
            page = next;
        }
        // The final page is part of the table as well.
        if (page > 0 && page * PageSize < bytes.Length && (bytes[page * PageSize + 27] & 0x40) == 0)
        {
            var offset = page * PageSize;
            foreach (var row in ReadRowsFromPage(bytes, offset)) yield return row;
        }
    }

    private static IEnumerable<int> ReadRowsFromPage(byte[] bytes, int pageOffset)
    {
        // rekordbox pages commonly contain more than one 16-row directory
        // group. Each group has its own offsets, presence mask and transaction
        // mask, laid out from the end of the page backwards.
        var slots = bytes[pageOffset + 24] + 0x100 * (bytes[pageOffset + 25] & 1);
        for (var slot = 0; slot < slots; slot++)
        {
            var groupBase = pageOffset + PageSize - slot / 16 * 0x24;
            var present = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(groupBase - 4, 2));
            var bit = slot % 16;
            if ((present & (1 << bit)) == 0) continue;
            var rowOffset = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(groupBase - 6 - 2 * bit, 2));
            yield return pageOffset + 40 + rowOffset;
        }
    }

    /// <summary>
    /// Decode the actual classic cue records, not just PCOB's advertised count.
    /// This intentionally does not share serialization helpers with the writer.
    /// </summary>
    public static void ValidateAnalysis(string analysisPath, string contentPath, IReadOnlyList<DeviceCue> expectedCues)
    {
        if (!File.Exists(analysisPath)) throw new InvalidOperationException($"Missing Pioneer analysis sidecar '{analysisPath}'.");
        var bytes = File.ReadAllBytes(analysisPath);
        if (bytes.Length < 28 || !bytes.AsSpan(0, 4).SequenceEqual("PMAI"u8))
            throw new InvalidOperationException("Generated Pioneer analysis file has an invalid header.");
        if (ReadBe32(bytes, 8) != bytes.Length) throw new InvalidOperationException("Generated Pioneer analysis file length does not match its header.");

        var position = ReadBe32(bytes, 4);
        if (position < 28 || position > bytes.Length) throw new InvalidOperationException("Invalid Pioneer analysis header length.");
        var foundPath = false;
        var foundMemory = false;
        var foundHot = false;
        var expected = expectedCues.OrderBy(c => c.StartSeconds).ToList();
        foreach (var cue in expected)
        {
            _ = ExpectedMilliseconds(cue.StartSeconds);
            if (!Enum.IsDefined(cue.Kind) || (cue.Kind == DeviceCueKind.Loop &&
                (cue.EndSeconds is not { } end || !double.IsFinite(end) || end <= cue.StartSeconds)))
                throw new InvalidOperationException("Invalid Wisp Memory Cue/loop data; correct the cue before exporting.");
        }
        while (position < bytes.Length)
        {
            if (bytes.Length - position < 12) throw new InvalidOperationException("Truncated Pioneer analysis section header.");
            var length = ReadBe32(bytes, position + 8);
            var header = ReadBe32(bytes, position + 4);
            if (length < 12 || length > bytes.Length - position || header < 12 || header > length)
                throw new InvalidOperationException("Generated Pioneer analysis section is malformed.");
            if (bytes.AsSpan(position, 4).SequenceEqual("PPTH"u8))
            {
                if (foundPath || header != 16 || length < 18 || ReadBe32(bytes, position + 12) != length - 16 || (length - 16) % 2 != 0 ||
                    bytes[position + length - 2] != 0 || bytes[position + length - 1] != 0 ||
                    Encoding.BigEndianUnicode.GetString(bytes, position + 16, length - 18) != contentPath)
                    throw new InvalidOperationException("Pioneer analysis audio path does not match the exported track.");
                foundPath = true;
            }
            if (bytes.AsSpan(position, 4).SequenceEqual("PCOB"u8))
            {
                if (header != 24 || length < 24) throw new InvalidOperationException("Invalid Pioneer cue-list header.");
                var type = ReadBe32(bytes, position + 12);
                var count = BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(position + 18, 2));
                if (type is not (0 or 1) || (type == 0 ? foundMemory : foundHot) || length != 24 + count * 56)
                    throw new InvalidOperationException("Invalid or duplicate Pioneer cue list, or cue record length mismatch.");
                if (type == 1)
                {
                    foundHot = true;
                    if (count != 0) throw new InvalidOperationException("This CDJ profile must not export Hot Cues.");
                }
                else
                {
                    foundMemory = true;
                    if (count != expected.Count) throw new InvalidOperationException("Generated Pioneer Memory Cue count does not match Wisp data.");
                    for (var i = 0; i < count; i++)
                    {
                        var cue = position + 24 + i * 56;
                        var wanted = expected[i];
                        if (!bytes.AsSpan(cue, 4).SequenceEqual("PCPT"u8) || ReadBe32(bytes, cue + 4) != 28 || ReadBe32(bytes, cue + 8) != 56 ||
                            ReadBe32(bytes, cue + 12) != 0 || ReadBe32(bytes, cue + 16) != 0 || ReadBe32(bytes, cue + 20) != 0x10000 ||
                            bytes[cue + 28] != (wanted.Kind == DeviceCueKind.Loop ? 2 : 1) ||
                            !bytes.AsSpan(cue + 29, 3).SequenceEqual(new byte[] { 0, 3, 0xe8 }) ||
                            BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(cue + 32, 4)) != ExpectedMilliseconds(wanted.StartSeconds) ||
                            BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(cue + 36, 4)) !=
                                (wanted.Kind == DeviceCueKind.Loop && wanted.EndSeconds is { } end ? ExpectedMilliseconds(end) : uint.MaxValue))
                            throw new InvalidOperationException($"Pioneer Memory Cue {i + 1} does not match its Wisp type, timestamp or record layout.");
                        if (BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(cue + 24, 2)) != (i == 0 ? ushort.MaxValue : i - 1) ||
                            BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(cue + 26, 2)) != (i == count - 1 ? ushort.MaxValue : i + 1))
                            throw new InvalidOperationException("Pioneer Memory Cue ordering is invalid.");
                    }
                }
            }
            position += length;
        }
        if (!foundPath || !foundMemory || !foundHot) throw new InvalidOperationException("Missing Pioneer audio path or cue lists.");
    }

    private static uint ExpectedMilliseconds(double seconds)
    {
        if (!double.IsFinite(seconds) || seconds < 0 || seconds * 1000 >= uint.MaxValue)
            throw new InvalidOperationException("A Pioneer cue has an invalid timestamp.");
        return checked((uint)Math.Round(seconds * 1000));
    }

    private static uint ReadLe32(byte[] source, int offset) => BinaryPrimitives.ReadUInt32LittleEndian(source.AsSpan(offset, 4));
    private static int ReadBe32(byte[] source, int offset) => checked((int)BinaryPrimitives.ReadUInt32BigEndian(source.AsSpan(offset, 4)));
}
