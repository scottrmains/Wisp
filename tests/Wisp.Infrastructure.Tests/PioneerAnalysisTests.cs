using System.Buffers.Binary;
using Wisp.Core.Cues;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Usb;

namespace Wisp.Infrastructure.Tests;

public sealed class PioneerAnalysisTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wisp-cue-layout-" + Guid.NewGuid().ToString("N"));
    private const string ContentPath = "/Contents/WISP/Test.mp3";

    private string Write(params DeviceCue[] cues)
    {
        var track = new Track { Id = Guid.NewGuid(), FilePath = "unused.mp3", FileName = "Test.mp3", FileHash = "test", Duration = TimeSpan.FromMinutes(3) };
        new PioneerDeviceLibraryWriter().Write(_root,
            [new PioneerExportTrack(1, ContentPath, "/PIONEER/USBANLZ/TEST/ANLZ0000.DAT", track, cues)], []);
        return Path.Combine(_root, "PIONEER", "USBANLZ", "TEST", "ANLZ0000.DAT");
    }

    private static DeviceCue Cue(double seconds, double? end = null) => new()
    {
        Kind = end is null ? DeviceCueKind.MemoryCue : DeviceCueKind.Loop,
        StartSeconds = seconds, EndSeconds = end,
    };

    // Independent layout oracle: offsets from crate-digger's cue_entry schema,
    // verified against rekordbox DAT records read on 2026-09-13. No personal
    // database, music or analysis file is checked into Git.
    [Fact]
    public void Single_memory_cue_matches_literal_56_byte_record()
    {
        var path = Write(Cue(12.345));
        var bytes = File.ReadAllBytes(path);
        var list = MemoryList(bytes);
        var expected = Convert.FromHexString(
            "504350540000001C00000038000000000000000000010000FFFFFFFF010003E800003039FFFFFFFF" +
            "00000000000000000000000000000000");
        Assert.Equal(56, expected.Length);
        Assert.Equal(80, Be32(bytes, list + 8));
        Assert.Equal(expected, bytes[(list + 24)..(list + 80)]);
        Assert.Equal(Convert.FromHexString("00000001000100000001000000000000"), bytes[12..28]);
    }

    [Fact]
    public void Multiple_cues_and_loop_decode_at_exact_boundaries_and_millisecond_offsets()
    {
        var path = Write(Cue(67.890, 70.123), Cue(0), Cue(12.345));
        var bytes = File.ReadAllBytes(path);
        var list = MemoryList(bytes);
        Assert.Equal(24 + 3 * 56, Be32(bytes, list + 8));
        uint[] times = [0, 12345, 67890];
        for (var i = 0; i < 3; i++)
        {
            var entry = list + 24 + i * 56;
            Assert.Equal("PCPT"u8.ToArray(), bytes[entry..(entry + 4)]);
            Assert.Equal(56, Be32(bytes, entry + 8));
            Assert.Equal(i == 2 ? 2 : 1, bytes[entry + 28]);
            Assert.Equal(times[i], BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(entry + 32, 4)));
            Assert.Equal(i == 2 ? 70123u : uint.MaxValue, BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(entry + 36, 4)));
        }
    }

    [Fact]
    public void Empty_lists_remain_well_formed()
    {
        var path = Write();
        var bytes = File.ReadAllBytes(path);
        Assert.Equal(24, Be32(bytes, MemoryList(bytes) + 8));
        PioneerDeviceLibraryValidator.ValidateAnalysis(path, ContentPath, []);
    }

    [Fact]
    public void Optional_real_rekordbox_memory_records_match_generated_records()
    {
        // Opt-in local conformance check. CI uses the literal oracle above;
        // personal USB fixtures never become a required or committed asset.
        var reference = Environment.GetEnvironmentVariable("WISP_PIONEER_ANLZ_DIR");
        if (string.IsNullOrWhiteSpace(reference)) return;
        var files = Directory.GetFiles(reference, "*.DAT", SearchOption.AllDirectories);
        Assert.NotEmpty(files);
        var compared = 0;
        foreach (var file in files)
        {
            var bytes = File.ReadAllBytes(file);
            var list = MemoryList(bytes);
            var count = BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(list + 18, 2));
            Assert.Equal(24 + 56 * count, Be32(bytes, list + 8));
            var records = new List<byte[]>();
            for (var i = 0; i < count; i++) records.Add(bytes[(list + 24 + 56 * i)..(list + 24 + 56 * (i + 1))]);
            records = records.OrderBy(record => Be32(record, 32)).ToList();
            var cues = records.Select(record => Cue(Be32(record, 32) / 1000d,
                record[28] == 2 ? Be32(record, 36) / 1000d : null)).ToArray();
            var generated = File.ReadAllBytes(Write(cues));
            var generatedList = MemoryList(generated);
            for (var i = 0; i < records.Count; i++)
            {
                // Wisp stores records in time order; rekordbox can retain
                // creation order. Normalize only the two linked-order fields.
                BinaryPrimitives.WriteUInt16BigEndian(records[i].AsSpan(24, 2), i == 0 ? ushort.MaxValue : (ushort)(i - 1));
                BinaryPrimitives.WriteUInt16BigEndian(records[i].AsSpan(26, 2), i == count - 1 ? ushort.MaxValue : (ushort)(i + 1));
                Assert.Equal(records[i], generated[(generatedList + 24 + i * 56)..(generatedList + 24 + (i + 1) * 56)]);
                compared++;
            }
        }
        Assert.True(compared > 0, "The opted-in reference must contain at least one Memory Cue.");
    }

    [Theory]
    [InlineData(0)] // PCPT signature
    [InlineData(7)] // header length
    [InlineData(11)] // entry length
    [InlineData(15)] // hot-cue number
    [InlineData(19)] // active-loop status
    [InlineData(21)] // fixed marker
    [InlineData(25)] // ordering
    [InlineData(28)] // cue type
    [InlineData(30)] // three-byte constant
    [InlineData(35)] // cue time
    [InlineData(39)] // loop end sentinel
    public void Validator_rejects_corrupt_cue_fields_even_with_correct_count(int relativeOffset)
    {
        var cues = new[] { Cue(12.345), Cue(67.890) };
        var path = Write(cues);
        var bytes = File.ReadAllBytes(path);
        bytes[MemoryList(bytes) + 24 + relativeOffset] ^= 1;
        File.WriteAllBytes(path, bytes);
        Assert.Throws<InvalidOperationException>(() => PioneerDeviceLibraryValidator.ValidateAnalysis(path, ContentPath, cues));
    }

    [Fact]
    public void Validator_rejects_old_60_byte_record_bug()
    {
        var cue = Cue(12.345);
        var path = Write(cue);
        var original = File.ReadAllBytes(path);
        var list = MemoryList(original);
        var insertion = list + 24 + 28;
        // Reproduce the old pair of uint32 fields instead of one byte + 3 bytes.
        var malformed = original[..insertion].Concat(Convert.FromHexString("00000001000003E8")).Concat(original[(insertion + 4)..]).ToArray();
        BinaryPrimitives.WriteUInt32BigEndian(malformed.AsSpan(8, 4), (uint)malformed.Length);
        BinaryPrimitives.WriteUInt32BigEndian(malformed.AsSpan(list + 8, 4), 84);
        File.WriteAllBytes(path, malformed);
        Assert.Throws<InvalidOperationException>(() => PioneerDeviceLibraryValidator.ValidateAnalysis(path, ContentPath, [cue]));
    }

    [Fact]
    public void Validator_rejects_wrong_audio_path_and_trailing_garbage()
    {
        var path = Write(Cue(12.345));
        Assert.Throws<InvalidOperationException>(() => PioneerDeviceLibraryValidator.ValidateAnalysis(path, "/wrong.mp3", [Cue(12.345)]));
        var bytes = File.ReadAllBytes(path).Concat(new byte[] { 1 }).ToArray();
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(8, 4), (uint)bytes.Length);
        File.WriteAllBytes(path, bytes);
        Assert.Throws<InvalidOperationException>(() => PioneerDeviceLibraryValidator.ValidateAnalysis(path, ContentPath, [Cue(12.345)]));
    }

    private static int MemoryList(byte[] bytes)
    {
        var cursor = Be32(bytes, 4);
        while (cursor < bytes.Length)
        {
            if (bytes.AsSpan(cursor, 4).SequenceEqual("PCOB"u8) && Be32(bytes, cursor + 12) == 0) return cursor;
            cursor += Be32(bytes, cursor + 8);
        }
        throw new InvalidOperationException("No memory list found by independent test decoder.");
    }

    private static int Be32(byte[] bytes, int offset) => checked((int)BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(offset, 4)));

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }
}
