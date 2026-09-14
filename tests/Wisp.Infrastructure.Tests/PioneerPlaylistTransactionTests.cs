using System.Buffers.Binary;
using System.Numerics;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Usb;

namespace Wisp.Infrastructure.Tests;

public sealed class PioneerPlaylistTransactionTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wisp-pdb-transactions-" + Guid.NewGuid().ToString("N"));
    private readonly PioneerDeviceLibraryWriter _writer = new();
    private readonly PioneerExportTrack _track;

    public PioneerPlaylistTransactionTests()
    {
        Directory.CreateDirectory(_root);
        var source = Path.Combine(_root, "sample.mp3");
        File.WriteAllBytes(source, [1, 2, 3, 4]);
        _track = new(1, "/Contents/WISP/sample.mp3", "", new Track
        {
            Id = Guid.NewGuid(), FilePath = source, FileName = "sample.mp3", FileHash = "test",
            Title = "Sample", Artist = "Artist", Genre = "House", Duration = TimeSpan.FromMinutes(3),
        }, []);
    }

    private string Template() => _writer.Write(Path.Combine(_root, "template"), [_track],
        [new(1, "Retained", [1])]).PdbPath;

    [Theory]
    [InlineData(1)]
    [InlineData(15)]
    [InlineData(16)]
    [InlineData(17)]
    [InlineData(40)]
    [InlineData(320)]
    public void Appends_reset_transaction_masks_across_groups_and_pages_and_keep_local_positions(int occurrences)
    {
        var template = Template();
        var original = File.ReadAllBytes(template);
        var playlists = new PioneerExportPlaylist[] {
            new(1, "Repeated", Enumerable.Repeat(1, occurrences).ToArray()),
            new(2, "Single", [1]), new(3, "Empty", []) };
        var result = _writer.WriteFromTemplate(Path.Combine(_root, "result"), template, [_track], playlists);
        var mappedTrack = _track with { DeviceId = result.TrackIdMap![1] };
        var mapped = playlists.Select(p => p with { DeviceId = result.PlaylistIdMap![p.DeviceId],
            TrackIds = p.TrackIds.Select(id => result.TrackIdMap![id]).ToArray() }).ToArray();
        PioneerDeviceLibraryValidator.Validate(result.PdbPath, [mappedTrack], mapped, true, false);
        Assert.Equal(original, File.ReadAllBytes(template));
        var bytes = File.ReadAllBytes(result.PdbPath);
        foreach (var playlist in mapped)
            Assert.Equal(Enumerable.Range(1, playlist.TrackIds.Count).Select(i => (uint)i),
                Rows(bytes, 8).Where(r => U32(bytes, r + 8) == playlist.DeviceId).Select(r => U32(bytes, r)));
        Assert.Equal(new uint[] { 0, 1, 2, 3 }, Rows(bytes, 7).Select(r => U32(bytes, r + 8)));
        // Independent check of all nonempty data pages, including pages no longer
        // last in a table. Every one-row append has exactly one transaction bit.
        foreach (var page in Pages(bytes, 8))
        {
            if ((bytes[page + 27] & 64) != 0) continue;
            var slots = (int)(U32(bytes, page + 24) & 8191);
            var changed = 0;
            for (var group = 0; group < (slots + 15) / 16; group++)
                changed += BitOperations.PopCount((uint)U16(bytes, page + 4096 - group * 36 - 2));
            Assert.Equal(1, changed);
            Assert.Equal(changed, U16(bytes, page + 32));
            Assert.Equal(slots - 1, U16(bytes, page + 34));
            Assert.True(U32(bytes, page + 16) < U32(bytes, 20));
        }
    }

    [Theory]
    [InlineData(0)] // zero-based
    [InlineData(2)] // gap/global position
    public void Validator_rejects_nonlocal_entry_positions(uint position)
    {
        var pdb = Template();
        var bytes = File.ReadAllBytes(pdb);
        W32(bytes, Rows(bytes, 8).Single(), position);
        File.WriteAllBytes(pdb, bytes);
        Assert.Contains("one-based", Assert.Throws<InvalidOperationException>(() =>
            PioneerDeviceLibraryValidator.Validate(pdb, [_track], [new(1, "Retained", [1])])).Message);
    }

    [Fact]
    public void Validator_uses_entry_positions_not_physical_row_order()
    {
        var other = _track with { DeviceId = 2 };
        var pdb = _writer.Write(Path.Combine(_root, "order"), [_track, other], [new(1, "Ordered", [1, 2])]).PdbPath;
        var bytes = File.ReadAllBytes(pdb);
        var rows = Rows(bytes, 8).ToArray();
        W32(bytes, rows[0], 2); W32(bytes, rows[1], 1);
        File.WriteAllBytes(pdb, bytes);
        PioneerDeviceLibraryValidator.Validate(pdb, [_track, other], [new(1, "Ordered", [2, 1])]);
        W32(bytes, rows[0], 1); // duplicate position
        File.WriteAllBytes(pdb, bytes);
        Assert.Contains("one-based", Assert.Throws<InvalidOperationException>(() =>
            PioneerDeviceLibraryValidator.Validate(pdb, [_track, other], [new(1, "Ordered", [2, 1])])).Message);
    }

    [Fact]
    public void Validator_rejects_duplicate_sibling_playlist_order()
    {
        var pdb = _writer.Write(Path.Combine(_root, "siblings"), [_track], [new(1, "One", [1]), new(2, "Two", [1])]).PdbPath;
        var bytes = File.ReadAllBytes(pdb);
        W32(bytes, Rows(bytes, 7).Last() + 8, 0);
        File.WriteAllBytes(pdb, bytes);
        Assert.Contains("sibling", Assert.Throws<InvalidOperationException>(() =>
            PioneerDeviceLibraryValidator.Validate(pdb, [_track], [new(1, "One", [1]), new(2, "Two", [1])])).Message);
    }

    [Theory]
    [InlineData("cycle")]
    [InlineData("identity")]
    [InlineData("flags")]
    [InlineData("count")]
    [InlineData("first")]
    [InlineData("outside-slot")]
    [InlineData("heap-overlap")]
    public void Validator_rejects_unsafe_table_or_transaction_metadata(string corruption)
    {
        var pdb = Template();
        var bytes = File.ReadAllBytes(pdb);
        var pages = Pages(bytes, 8).ToArray(); var page = pages.Last();
        switch (corruption)
        {
            case "cycle": W32(bytes, pages[0] + 12, (uint)(pages[0] / 4096)); break;
            case "identity": W32(bytes, page + 8, 0); break;
            case "flags": bytes[page + 27] = 0; break;
            case "count": W16(bytes, page + 32, 2); break;
            case "first": W16(bytes, page + 34, 7); break;
            case "outside-slot": W16(bytes, page + 4094, 3); break;
            case "heap-overlap": W16(bytes, page + 30, 4095); break;
        }
        File.WriteAllBytes(pdb, bytes);
        Assert.Throws<InvalidOperationException>(() =>
            PioneerDeviceLibraryValidator.Validate(pdb, [_track], [new(1, "Retained", [1])]));
    }

    [Fact]
    public void Optional_private_precrash_fixture_is_rejected_and_repaired_fixture_validates()
    {
        var bad = Environment.GetEnvironmentVariable("WISP_PIONEER_PRECRASH_FIXTURE");
        if (!string.IsNullOrWhiteSpace(bad))
            Assert.Contains("transaction", Assert.Throws<InvalidOperationException>(() =>
                PioneerDeviceLibraryValidator.Validate(bad, [], [], true, false)).Message);
        var repaired = Environment.GetEnvironmentVariable("WISP_PIONEER_REPAIRED_FIXTURE");
        if (string.IsNullOrWhiteSpace(repaired)) return;
        var bytes = File.ReadAllBytes(repaired);
        var playlists = Rows(bytes, 7).Where(r => U32(bytes, r + 16) == 0).Select(r =>
        {
            var id = U32(bytes, r + 12);
            return new PioneerExportPlaylist((int)id, $"Private fixture {id}",
                Rows(bytes, 8).Where(e => U32(bytes, e + 8) == id).Select(e => (int)U32(bytes, e + 4)).ToArray());
        }).ToArray();
        PioneerDeviceLibraryValidator.Validate(repaired, [], playlists, true, false);
    }

    [Fact]
    public void Rejects_the_crash_pattern_before_appending_to_a_bad_template()
    {
        var pdb = _writer.Write(Path.Combine(_root, "bad"), [_track], [new(1, "Repeated", [1, 1])]).PdbPath;
        var bytes = File.ReadAllBytes(pdb);
        var page = Pages(bytes, 8).Last();
        // Historical WISP bug: count=1 but both old and new transaction bits set.
        W16(bytes, page + 32, 1); W16(bytes, page + 34, 1);
        Assert.Equal(3, U16(bytes, page + 4094));
        File.WriteAllBytes(pdb, bytes);
        var output = Path.Combine(_root, "rejected");
        Assert.Contains("transaction", Assert.Throws<InvalidOperationException>(() =>
            _writer.WriteFromTemplate(output, pdb, [_track], [new(1, "New", [1])])).Message);
        Assert.False(Directory.Exists(output));
        Assert.Equal(bytes, File.ReadAllBytes(pdb));
    }

    [Fact]
    public void Retains_native_failed_transaction_sentinels_without_treating_them_as_counts()
    {
        var pdb = Template();
        var bytes = File.ReadAllBytes(pdb);
        var page = Pages(bytes, 8).Last();
        W16(bytes, page + 32, 0x1fff); W16(bytes, page + 34, 0x1fff);
        File.WriteAllBytes(pdb, bytes);
        PioneerDeviceLibraryValidator.Validate(pdb, [_track], [new(1, "Retained", [1])]);
    }

    [Fact]
    public void Missing_playlist_tracks_are_not_silently_skipped()
    {
        Assert.Contains("unexported", Assert.Throws<InvalidOperationException>(() =>
            _writer.WriteFromTemplate(Path.Combine(_root, "missing"), Template(), [_track], [new(1, "Missing", [123])])).Message);
    }

    private static IEnumerable<int> Pages(byte[] b, int type)
    {
        var pointer = 28 + type * 16;
        var page = U32(b, pointer + 8); var last = U32(b, pointer + 12);
        var visited = new HashSet<uint>();
        while (true)
        {
            Assert.True(visited.Add(page));
            var p = checked((int)page * 4096);
            yield return p;
            if (page == last) yield break;
            page = U32(b, p + 12);
        }
    }
    private static IEnumerable<int> Rows(byte[] b, int type)
    {
        foreach (var p in Pages(b, type))
        {
            if ((b[p + 27] & 64) != 0) continue;
            for (var s = 0; s < (U32(b, p + 24) & 8191); s++)
            {
                var footer = p + 4096 - s / 16 * 36;
                if ((U16(b, footer - 4) & (1 << (s % 16))) != 0)
                    yield return p + 40 + U16(b, footer - 6 - (s % 16) * 2);
            }
        }
    }
    private static uint U32(byte[] b, int p) => BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(p));
    private static ushort U16(byte[] b, int p) => BinaryPrimitives.ReadUInt16LittleEndian(b.AsSpan(p));
    private static void W32(byte[] b, int p, uint v) => BinaryPrimitives.WriteUInt32LittleEndian(b.AsSpan(p), v);
    private static void W16(byte[] b, int p, ushort v) => BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(p), v);
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }
}
