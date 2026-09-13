using Wisp.Core.Cues;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Usb;

namespace Wisp.Infrastructure.Tests;

public sealed class PioneerUsbExportServiceTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wisp-pioneer-" + Guid.NewGuid().ToString("N"));

    public PioneerUsbExportServiceTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        try { Directory.Delete(_root, recursive: true); } catch { /* best effort */ }
    }

    [Fact]
    public async Task Export_writes_classic_catalogue_and_memory_cue_analysis()
    {
        var source = Path.Combine(_root, "source", "Artist - Track.mp3");
        Directory.CreateDirectory(Path.GetDirectoryName(source)!);
        await File.WriteAllBytesAsync(source, [1, 2, 3, 4]);
        var track = MakeTrack(source);
        var cue = new DeviceCue
        {
            Id = Guid.NewGuid(), TrackId = track.Id, Kind = DeviceCueKind.MemoryCue,
            StartSeconds = 12.345, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        var usb = Path.Combine(_root, "usb");
        Directory.CreateDirectory(usb);

        var service = new PioneerUsbExportService(new PioneerDeviceLibraryWriter());
        var result = await service.ExportAsync(usb, "Test plan", [track], [new UsbPlaylist("Test plan", [track])], [cue], false, CancellationToken.None);

        Assert.True(File.Exists(result.StagedPdbPath));
        Assert.True(File.Exists(result.ReceiptPath));
        var receipt = await File.ReadAllTextAsync(result.ReceiptPath);
        Assert.Contains("MemoryCueCount", receipt);
        Assert.Contains("\"MemoryCueCount\": 1", receipt);
        Assert.Contains("\"Version\": 2", receipt);
        Assert.Contains("\"StartMilliseconds\": 12345", receipt);
        Assert.True(Directory.Exists(Path.Combine(usb, "Contents", "WISP")));
        Assert.Single(Directory.EnumerateFiles(usb, "ANLZ0000.DAT", SearchOption.AllDirectories));
        Assert.False(Directory.Exists(Path.Combine(usb, ".wisp-pioneer-staging")));
    }

    [Fact]
    public async Task Export_requires_explicit_confirmation_and_preserves_existing_pioneer_library()
    {
        var source = Path.Combine(_root, "source", "Artist - Track.mp3");
        Directory.CreateDirectory(Path.GetDirectoryName(source)!);
        await File.WriteAllBytesAsync(source, [1, 2, 3, 4]);
        var track = MakeTrack(source);
        var usb = Path.Combine(_root, "usb");
        var existing = Path.Combine(usb, "PIONEER");
        Directory.CreateDirectory(existing);
        await File.WriteAllTextAsync(Path.Combine(existing, "keep.txt"), "original");
        var service = new PioneerUsbExportService(new PioneerDeviceLibraryWriter());

        await Assert.ThrowsAsync<PioneerLibraryExistsException>(() => service.ExportAsync(usb, "Test", [track], [new UsbPlaylist("Test", [track])], [], false, CancellationToken.None));
        Assert.Equal("original", await File.ReadAllTextAsync(Path.Combine(existing, "keep.txt")));

        var result = await service.ExportAsync(usb, "Test", [track], [new UsbPlaylist("Test", [track])], [], true, CancellationToken.None);
        Assert.NotNull(result.PioneerBackupPath);
        Assert.Equal("original", await File.ReadAllTextAsync(Path.Combine(result.PioneerBackupPath!, "keep.txt")));
        Assert.True(File.Exists(Path.Combine(usb, "PIONEER", "rekordbox", "EXPORT.PDB")));
    }

    [Fact]
    public async Task Export_writes_pioneer_track_offsets_after_file_type_fields()
    {
        var source = Path.Combine(_root, "source", "Artist - Track.mp3");
        Directory.CreateDirectory(Path.GetDirectoryName(source)!);
        await File.WriteAllBytesAsync(source, [1, 2, 3, 4]);
        var track = MakeTrack(source);
        var usb = Path.Combine(_root, "usb");
        Directory.CreateDirectory(usb);

        var result = await new PioneerUsbExportService(new PioneerDeviceLibraryWriter())
            .ExportAsync(usb, "Test", [track], [new UsbPlaylist("Test", [track])], [], false, CancellationToken.None);

        var bytes = await File.ReadAllBytesAsync(result.StagedPdbPath);
        const int pageSize = 4096;
        const int firstTrackIndexPage = 1;
        const int firstTrackDataPage = 2; // page 1 is the empty Track-table index page.
        var indexPage = firstTrackIndexPage * pageSize;
        Assert.Equal((uint)firstTrackIndexPage, BitConverter.ToUInt32(bytes, indexPage + 40));
        Assert.Equal((uint)firstTrackDataPage, BitConverter.ToUInt32(bytes, indexPage + 44));
        Assert.Equal((ushort)0x1fff, BitConverter.ToUInt16(bytes, indexPage + 34));
        Assert.Equal(0x1ffffff8u, BitConverter.ToUInt32(bytes, indexPage + 60));

        var page = firstTrackDataPage * pageSize;
        var firstOffset = BitConverter.ToUInt16(bytes, page + pageSize - 6);
        var row = page + 40 + firstOffset;

        Assert.Equal((ushort)0x01, BitConverter.ToUInt16(bytes, row + 0x5a));
        Assert.Equal((ushort)3, BitConverter.ToUInt16(bytes, row + 0x5c));
        Assert.True(BitConverter.ToUInt16(bytes, row + 0x5e) >= 0x88);
        Assert.True(BitConverter.ToUInt16(bytes, row + 0x86) >= 0x88);
    }

    [Fact]
    public async Task Export_writes_rekordbox_style_empty_index_pages_without_cycles()
    {
        var source = Path.Combine(_root, "source", "Artist - Track.mp3");
        Directory.CreateDirectory(Path.GetDirectoryName(source)!);
        await File.WriteAllBytesAsync(source, [1, 2, 3, 4]);
        var track = MakeTrack(source);
        var usb = Path.Combine(_root, "usb");
        Directory.CreateDirectory(usb);

        var result = await new PioneerUsbExportService(new PioneerDeviceLibraryWriter())
            .ExportAsync(usb, "Test", [track], [new UsbPlaylist("Test", [track])], [], false, CancellationToken.None);

        var bytes = await File.ReadAllBytesAsync(result.StagedPdbPath);
        const int pageSize = 4096;
        var tableCount = BitConverter.ToUInt32(bytes, 8);
        for (var type = 0; type < tableCount; type++)
        {
            var table = 0x1c + type * 16;
            var firstPage = BitConverter.ToUInt32(bytes, table + 8);
            var lastPage = BitConverter.ToUInt32(bytes, table + 12);
            var index = checked((int)firstPage * pageSize);

            var indexNext = BitConverter.ToUInt32(bytes, index + 44);
            Assert.NotEqual(0u, BitConverter.ToUInt32(bytes, table + 4));
            if (lastPage == firstPage)
            {
                Assert.Equal(BitConverter.ToUInt32(bytes, table + 4), BitConverter.ToUInt32(bytes, index + 12));
                Assert.Equal(0x03ffffffu, indexNext);
            }
            else
            {
                Assert.Equal(firstPage + 1, BitConverter.ToUInt32(bytes, index + 12));
                Assert.Equal(firstPage + 1, indexNext);
            }
            Assert.Equal((ushort)0x1fff, BitConverter.ToUInt16(bytes, index + 32));
            Assert.Equal((ushort)0x1fff, BitConverter.ToUInt16(bytes, index + 34));
            Assert.Equal(0x1ffffff8u, BitConverter.ToUInt32(bytes, index + 60));

            // The logical table is bounded by lastPage, even though the
            // physical next-page link points to the following allocation.
            Assert.True(lastPage >= firstPage);
        }
    }

    [Fact]
    public async Task Template_writer_appends_tracks_and_playlists_without_rebuilding_the_database()
    {
        var firstSource = Path.Combine(_root, "source", "Artist - First.mp3");
        var secondSource = Path.Combine(_root, "source", "Artist - Second.mp3");
        Directory.CreateDirectory(Path.GetDirectoryName(firstSource)!);
        await File.WriteAllBytesAsync(firstSource, [1, 2, 3, 4]);
        await File.WriteAllBytesAsync(secondSource, [5, 6, 7, 8]);
        var writer = new PioneerDeviceLibraryWriter();
        var initial = MakeTrack(firstSource);
        var templateRoot = Path.Combine(_root, "template");
        var template = writer.Write(templateRoot,
            [new PioneerExportTrack(1, "/Contents/WISP/Artist/First.mp3", "", initial, [])],
            [new PioneerExportPlaylist(1, "Existing", [1])]);

        var appended = MakeTrack(secondSource);
        var stagedRoot = Path.Combine(_root, "staged");
        var result = writer.WriteFromTemplate(stagedRoot, template.PdbPath,
            [new PioneerExportTrack(1, "/Contents/WISP/Artist/Second.mp3", "", appended, [])],
            [new PioneerExportPlaylist(1, "Wisp test", [1])]);
        var mappedTrack = new PioneerExportTrack(result.TrackIdMap![1], "/Contents/WISP/Artist/Second.mp3", "", appended, []);
        var mappedPlaylist = new PioneerExportPlaylist(result.PlaylistIdMap![1], "Wisp test", [mappedTrack.DeviceId]);

        PioneerDeviceLibraryValidator.Validate(result.PdbPath, [mappedTrack], [mappedPlaylist], allowAdditionalRows: true, validateFreshPageLayout: false);
        Assert.NotEqual(1, mappedTrack.DeviceId);
        Assert.NotEqual(1, mappedPlaylist.DeviceId);
    }

    [Fact]
    public async Task Template_writer_accepts_an_optional_real_rekordbox_fixture()
    {
        var templatePath = Environment.GetEnvironmentVariable("WISP_PIONEER_TEMPLATE");
        if (string.IsNullOrWhiteSpace(templatePath) || !File.Exists(templatePath)) return;

        var source = Path.Combine(_root, "source", "Fixture - Track.mp3");
        Directory.CreateDirectory(Path.GetDirectoryName(source)!);
        await File.WriteAllBytesAsync(source, [1, 2, 3, 4]);
        var track = MakeTrack(source);
        var before = await File.ReadAllBytesAsync(templatePath);
        var cues = new[] { new DeviceCue { TrackId = track.Id, Kind = DeviceCueKind.MemoryCue, StartSeconds = 12.345 },
            new DeviceCue { TrackId = track.Id, Kind = DeviceCueKind.MemoryCue, StartSeconds = 67.890 } };
        const string analysisPath = "/PIONEER/USBANLZ/WISPTEST/ANLZ0000.DAT";
        var result = new PioneerDeviceLibraryWriter().WriteFromTemplate(Path.Combine(_root, "fixture-staged"), templatePath,
            [new PioneerExportTrack(1, "/Contents/WISP/Artist/Fixture.mp3", analysisPath, track, cues)],
            [new PioneerExportPlaylist(1, "Wisp fixture verification", [1])]);
        var mappedTrack = new PioneerExportTrack(result.TrackIdMap![1], "/Contents/WISP/Artist/Fixture.mp3", analysisPath, track, cues);
        var mappedPlaylist = new PioneerExportPlaylist(result.PlaylistIdMap![1], "Wisp fixture verification", [mappedTrack.DeviceId]);

        PioneerDeviceLibraryValidator.Validate(result.PdbPath, [mappedTrack], [mappedPlaylist], allowAdditionalRows: true, validateFreshPageLayout: false);
        Assert.Equal(before, await File.ReadAllBytesAsync(templatePath));
    }

    private static Track MakeTrack(string source) => new()
    {
        Id = Guid.NewGuid(), FilePath = source, FileName = Path.GetFileName(source), FileHash = "hash",
        Artist = "Artist", Title = "Track", Genre = "House", Bpm = 124.5m,
        Duration = TimeSpan.FromSeconds(180), AddedAt = DateTime.UtcNow,
    };
}
