using System.Buffers.Binary;
using Microsoft.Extensions.Logging.Abstractions;
using Wisp.Core.Cues;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.Usb;

namespace Wisp.Infrastructure.Tests;

public sealed class PioneerWaveformTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wisp-waveform-" + Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Overview_covers_silence_quiet_loud_and_last_sample_without_stereo_cancellation()
    {
        using var pcm = Pcm(44100, i => i < 11025 ? 0 : i < 22050 ? 0.04f : i < 44099 ? 0.8f : 1);
        var waveform = await PioneerWaveformAnalyzer.ReadPcmAsync(pcm, default);
        Assert.Equal(44100, waveform.SampleFrames);
        Assert.Equal(400, waveform.Preview.Length);
        Assert.Equal(100, waveform.Tiny.Length);
        Assert.All(waveform.Preview[..100], b => Assert.Equal(0, b));
        Assert.InRange(waveform.Preview[150] & 31, 1, 15);
        Assert.True((waveform.Preview[300] & 31) > (waveform.Preview[150] & 31));
        Assert.True((waveform.Preview[^1] & 31) > 0);
        Assert.All(waveform.Tiny, b => Assert.InRange(b, 0, 15));
    }

    [Fact]
    public async Task Silence_has_no_fabricated_waveform()
    {
        using var pcm = Pcm(1001, _ => 0);
        var waveform = await PioneerWaveformAnalyzer.ReadPcmAsync(pcm, default);
        Assert.All(waveform.Preview, b => Assert.Equal(0, b));
        Assert.All(waveform.Tiny, b => Assert.Equal(0, b));
    }

    [Fact]
    public async Task Partial_reads_and_short_tail_are_not_lost()
    {
        using var source = Pcm(1001, i => i == 1000 ? 1 : 0);
        using var fragmented = new FragmentedStream(source.ToArray());
        var actual = await PioneerWaveformAnalyzer.ReadPcmAsync(fragmented, default);
        var expected = await PioneerWaveformAnalyzer.ReadPcmAsync(source, default);
        Assert.Equal(expected.Preview, actual.Preview);
        Assert.Equal(1001, actual.SampleFrames);
        Assert.True((actual.Preview[^1] & 31) > 0);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(3)]
    [InlineData(9)]
    public async Task Empty_or_truncated_pcm_is_rejected(int length)
    {
        using var pcm = new MemoryStream(new byte[length]);
        await Assert.ThrowsAsync<PioneerWaveformException>(() => PioneerWaveformAnalyzer.ReadPcmAsync(pcm, default));
    }

    [Fact]
    public async Task Invalid_samples_and_cancellation_are_rejected()
    {
        using var pcm = Pcm(10, _ => float.NaN);
        await Assert.ThrowsAsync<PioneerWaveformException>(() => PioneerWaveformAnalyzer.ReadPcmAsync(pcm, default));
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        using var valid = Pcm(10, _ => 1);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => PioneerWaveformAnalyzer.ReadPcmAsync(valid, cancelled.Token));
    }

    [Fact]
    public async Task Waveform_tags_match_reference_headers_and_cues_are_unchanged()
    {
        var (path, waveform, track) = await WriteWaveform();
        var bytes = File.ReadAllBytes(path);
        var preview = FindTag(bytes, "PWAV");
        var tiny = FindTag(bytes, "PWV2");
        Assert.Equal(Convert.FromHexString("5057415600000014000001A40000019000010000"), bytes[preview..(preview + 20)]);
        Assert.Equal(Convert.FromHexString("5057563200000014000000780000006400010000"), bytes[tiny..(tiny + 20)]);
        Assert.Equal(waveform.Preview, bytes[(preview + 20)..(preview + 420)]);
        Assert.Equal(waveform.Tiny, bytes[(tiny + 20)..(tiny + 120)]);
        PioneerDeviceLibraryValidator.ValidateAnalysis(path, track.ContentPath, track.DeviceCues, waveform);

        var reference = Environment.GetEnvironmentVariable("WISP_PIONEER_ANLZ_DIR");
        if (!string.IsNullOrWhiteSpace(reference))
            foreach (var file in Directory.GetFiles(reference, "ANLZ0000.DAT", SearchOption.AllDirectories))
            {
                var oracle = File.ReadAllBytes(file);
                foreach (var tag in new[] { "PWAV", "PWV2" })
                {
                    var expected = FindTag(oracle, tag); var actual = FindTag(bytes, tag);
                    Assert.Equal(oracle[expected..(expected + 20)], bytes[actual..(actual + 20)]);
                }
            }
    }

    [Theory]
    [InlineData(7)]
    [InlineData(11)]
    [InlineData(15)]
    [InlineData(17)]
    [InlineData(20)]
    public async Task Validator_rejects_corrupt_waveform_header_or_payload(int offset)
    {
        var (path, waveform, track) = await WriteWaveform();
        var bytes = File.ReadAllBytes(path);
        bytes[FindTag(bytes, "PWAV") + offset] ^= 1;
        File.WriteAllBytes(path, bytes);
        Assert.Throws<InvalidOperationException>(() => PioneerDeviceLibraryValidator.ValidateAnalysis(path, track.ContentPath, track.DeviceCues, waveform));
    }

    [Fact]
    public async Task Validator_rejects_missing_waveform_and_wrong_database_link_or_date()
    {
        var (path, waveform, track) = await WriteWaveform();
        var writer = new PioneerDeviceLibraryWriter();
        var noWave = writer.Write(Path.Combine(_root, "no-wave"), [track with { Waveform = null }], []);
        var missing = Path.Combine(_root, "no-wave", track.AnalysisPath.TrimStart('/'));
        Assert.Throws<InvalidOperationException>(() => PioneerDeviceLibraryValidator.ValidateAnalysis(missing, track.ContentPath, track.DeviceCues, waveform));
        var pdb = Path.Combine(_root, "PIONEER", "rekordbox", "export.pdb");
        var original = File.ReadAllBytes(pdb);
        const int page = 2 * 4096;
        var row = page + 40 + BinaryPrimitives.ReadUInt16LittleEndian(original.AsSpan(page + 4096 - 6));
        foreach (var field in new[] { 14, 15, 20 })
        {
            var bytes = (byte[])original.Clone();
            var value = row + BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(row + 0x5e + field * 2));
            bytes[value + 1] ^= 1;
            File.WriteAllBytes(pdb, bytes);
            Assert.Throws<InvalidOperationException>(() => PioneerDeviceLibraryValidator.Validate(pdb, [track], []));
        }
        Assert.True(File.Exists(path));
    }

    [Fact]
    public async Task Analyzer_failure_leaves_existing_usb_library_and_contents_untouched()
    {
        Directory.CreateDirectory(Path.Combine(_root, "PIONEER"));
        Directory.CreateDirectory(Path.Combine(_root, "Contents", "WISP"));
        var existing = Path.Combine(_root, "PIONEER", "keep.txt"); File.WriteAllText(existing, "original");
        var audio = Path.Combine(_root, "Contents", "WISP", "old.mp3"); File.WriteAllBytes(audio, [7, 8]);
        var track = Track(audio);
        var analyzer = new FailingAnalyzer();
        var service = new PioneerUsbExportService(new PioneerDeviceLibraryWriter(), waveforms: analyzer);
        await Assert.ThrowsAsync<PioneerWaveformException>(() => service.ExportAsync(_root, "Test", [track], [new("Test", [track])], [], true, default));
        Assert.Equal("original", File.ReadAllText(existing));
        Assert.Equal(new byte[] { 7, 8 }, File.ReadAllBytes(audio));
        Assert.Empty(Directory.GetDirectories(_root, ".wisp-pioneer-staging-*"));
        Assert.False(File.Exists(Path.Combine(_root, "WISP", "pioneer-export-receipt.json")));
    }

    [Fact]
    public async Task Optional_ffmpeg_decodes_real_audio_and_export_installs_validated_waveforms()
    {
        var executable = Environment.GetEnvironmentVariable("WISP_TEST_FFMPEG");
        if (string.IsNullOrWhiteSpace(executable)) return;
        Directory.CreateDirectory(_root);
        var audio = Path.Combine(_root, "synthetic anti phase.wav");
        using (var file = File.Create(audio))
        using (var writer = new BinaryWriter(file))
        {
            const int frames = 44100;
            writer.Write("RIFF"u8); writer.Write(36 + frames * 4); writer.Write("WAVEfmt "u8);
            writer.Write(16); writer.Write((short)1); writer.Write((short)2); writer.Write(44100); writer.Write(176400);
            writer.Write((short)4); writer.Write((short)16); writer.Write("data"u8); writer.Write(frames * 4);
            for (var i = 0; i < frames; i++) { var value = (short)(i < 11025 ? 0 : Math.Sin(i * Math.PI * 2 * 440 / 44100) * 16000); writer.Write(value); writer.Write((short)-value); }
        }
        var original = File.ReadAllBytes(audio);
        var analyzer = new PioneerWaveformAnalyzer(new Mp3Transcoder(NullLogger<Mp3Transcoder>.Instance, () => executable));
        var usb = Path.Combine(_root, "usb"); Directory.CreateDirectory(usb);
        var track = Track(audio); // Deliberately wrong duration must not stretch the waveform.
        var service = new PioneerUsbExportService(new PioneerDeviceLibraryWriter(), waveforms: analyzer);
        var result = await service.ExportAsync(usb, "Test", [track], [new("Test", [track])], [], false, default);
        Assert.Equal(original, File.ReadAllBytes(audio));
        var receipt = File.ReadAllText(result.ReceiptPath);
        Assert.Contains("\"WaveformPreviewColumns\": 400", receipt);
        Assert.Contains("\"WaveformTinyColumns\": 100", receipt);
        Assert.Contains("\"DecodedSampleFrames\": 44100", receipt);
        var dat = File.ReadAllBytes(Directory.GetFiles(usb, "ANLZ0000.DAT", SearchOption.AllDirectories).Single());
        var start = FindTag(dat, "PWAV") + 20;
        Assert.All(dat[start..(start + 100)], b => Assert.Equal(0, b));
        Assert.Contains(dat[(start + 100)..(start + 400)], b => (b & 31) > 0);
        var corrupt = Path.Combine(_root, "corrupt.mp3"); File.WriteAllBytes(corrupt, [1, 2, 3]);
        await Assert.ThrowsAsync<PioneerWaveformException>(() => analyzer.AnalyzeAsync(corrupt, default));
    }

    [Fact]
    public async Task Optional_private_export_audio_analyzes_and_template_links_every_waveform()
    {
        // Read-only opt-in hardware-export inputs. Output is isolated under the
        // test's random temp root; no USB, music or private fixture is modified.
        var receiptPath = Environment.GetEnvironmentVariable("WISP_TEST_CDJ_RECEIPT");
        var template = Environment.GetEnvironmentVariable("WISP_PIONEER_TEMPLATE");
        var executable = Environment.GetEnvironmentVariable("WISP_TEST_FFMPEG");
        if (string.IsNullOrWhiteSpace(receiptPath) || string.IsNullOrWhiteSpace(template) || string.IsNullOrWhiteSpace(executable)) return;
        var receipt = System.Text.Json.JsonSerializer.Deserialize<PioneerExportReceipt>(File.ReadAllText(receiptPath))!;
        var sourceRoot = Path.GetDirectoryName(Path.GetDirectoryName(receiptPath)!)!;
        var analyzer = new PioneerWaveformAnalyzer(new Mp3Transcoder(NullLogger<Mp3Transcoder>.Instance, () => executable));
        var tracks = new List<PioneerExportTrack>();
        foreach (var entry in receipt.Tracks)
        {
            var path = Path.GetFullPath(Path.Combine(sourceRoot, entry.ContentPath.TrimStart('/')));
            Assert.StartsWith(sourceRoot, path);
            var hash = System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(path));
            var waveform = await analyzer.AnalyzeAsync(path, default);
            Assert.True(waveform.SampleFrames > 44100);
            Assert.Contains(waveform.Preview, b => (b & 31) > 0);
            Assert.True(waveform.Preview.Distinct().Count() > 1);
            Assert.Equal(hash, System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(path)));
            tracks.Add(new(entry.DeviceId, entry.ContentPath, PioneerAnalysisPath.ForAudio(entry.ContentPath), Track(path),
                entry.MemoryCues!.Select(cue => new DeviceCue { Kind = Enum.Parse<DeviceCueKind>(cue.Kind), StartSeconds = cue.StartMilliseconds / 1000d, EndSeconds = cue.EndMilliseconds / 1000d }).ToList(), waveform));
        }
        Assert.NotEmpty(tracks);
        var playlists = new[] { new PioneerExportPlaylist(1, "Private waveform verification", tracks.Select(t => t.DeviceId).ToList()) };
        var result = new PioneerDeviceLibraryWriter().WriteFromTemplate(_root, template, tracks, playlists);
        var mapped = tracks.Select(t => t with { DeviceId = result.TrackIdMap![t.DeviceId] }).ToList();
        var mappedPlaylists = playlists.Select(p => p with { DeviceId = result.PlaylistIdMap![p.DeviceId], TrackIds = p.TrackIds.Select(id => result.TrackIdMap![id]).ToList() }).ToList();
        PioneerDeviceLibraryValidator.Validate(result.PdbPath, mapped, mappedPlaylists, allowAdditionalRows: true, validateFreshPageLayout: false);
    }

    private async Task<(string Path, PioneerWaveform Waveform, PioneerExportTrack Track)> WriteWaveform()
    {
        using var pcm = Pcm(44100, _ => 0.2f);
        var waveform = await PioneerWaveformAnalyzer.ReadPcmAsync(pcm, default);
        var track = new PioneerExportTrack(1, "/Contents/WISP/test.mp3", PioneerAnalysisPath.ForAudio("/Contents/WISP/test.mp3"), Track("test.mp3"),
            [new DeviceCue { StartSeconds = 12.345, Kind = DeviceCueKind.MemoryCue }], waveform);
        new PioneerDeviceLibraryWriter().Write(_root, [track], []);
        return (Path.Combine(_root, track.AnalysisPath.TrimStart('/')), waveform, track);
    }

    private static Track Track(string path) => new() { Id = Guid.NewGuid(), FilePath = path, FileName = Path.GetFileName(path), FileHash = "test", Duration = TimeSpan.FromMinutes(10) };
    private static MemoryStream Pcm(int frames, Func<int, float> sample)
    {
        var bytes = new byte[frames * 8];
        for (var i = 0; i < frames; i++) { BinaryPrimitives.WriteSingleLittleEndian(bytes.AsSpan(i * 8), sample(i)); BinaryPrimitives.WriteSingleLittleEndian(bytes.AsSpan(i * 8 + 4), -sample(i)); }
        return new MemoryStream(bytes);
    }
    private static int FindTag(byte[] bytes, string tag)
    {
        for (var pos = 28; pos < bytes.Length; pos += checked((int)BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(pos + 8))))
            if (System.Text.Encoding.ASCII.GetString(bytes, pos, 4) == tag) return pos;
        throw new InvalidOperationException("Missing " + tag);
    }
    private sealed class FragmentedStream(byte[] bytes) : MemoryStream(bytes)
    {
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default) => base.ReadAsync(buffer[..Math.Min(buffer.Length, 7)], ct);
    }
    private sealed class FailingAnalyzer : IPioneerWaveformAnalyzer
    {
        public Task<PioneerWaveform> AnalyzeAsync(string path, CancellationToken ct) => throw new PioneerWaveformException("Test decoder failure");
    }
    public void Dispose() { if (Directory.Exists(_root)) Directory.Delete(_root, true); }
}
