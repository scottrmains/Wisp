using Wisp.Core.Tracks;
using Wisp.Infrastructure.Usb;

namespace Wisp.Infrastructure.Tests;

public sealed class UsbExportDevicesTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wisp-usb-target-" + Guid.NewGuid().ToString("N"));
    private static UsbExportDevice Device(string root) => new("disk-A", root, "DJ USB", "Flash drive", 32000000000, 30000000000, "FAT32", "MBR", 1, false, false, "USB");

    [Theory]
    [InlineData("GPT", 1, "FAT32")]
    [InlineData("GPT", 2, "FAT32")]
    [InlineData("MBR", 2, "FAT32")]
    [InlineData("MBR", 1, "NTFS")]
    [InlineData("MBR", 1, "EXFAT")]
    [InlineData("RAW", 0, "")]
    public void Unsupported_layouts_are_blocked_even_when_volume_is_fat32(string style, int partitions, string filesystem)
    {
        var device = Device(_root) with { PartitionStyle = style, PartitionCount = partitions, FileSystem = filesystem };
        Assert.False(device.CanExport);
        Assert.NotEmpty(device.CompatibilityProblem!);
        Assert.Throws<UsbExportTargetException>(() => UsbExportTarget.Require([device], _root, device.DeviceId));
    }

    [Fact]
    public void Internal_system_readonly_and_unready_disks_are_not_export_targets()
    {
        var good = Device(_root);
        Assert.True(good.CanExport);
        foreach (var bad in new[] { good with { BusType = "SATA" }, good with { IsSystem = true }, good with { IsReadOnly = true }, good with { SizeBytes = 0 } })
            Assert.Throws<UsbExportTargetException>(() => UsbExportTarget.Require([bad], _root, bad.DeviceId));
    }

    [Fact]
    public void Missing_swapped_and_folder_targets_do_not_silently_select_another_device()
    {
        var device = Device(_root);
        Assert.Equal(device, UsbExportTarget.Require([device], _root, device.DeviceId));
        Assert.Throws<UsbExportTargetException>(() => UsbExportTarget.Require([], _root, device.DeviceId));
        Assert.Throws<UsbExportTargetException>(() => UsbExportTarget.Require([device with { DeviceId = "disk-B" }], _root, device.DeviceId));
        Assert.Throws<UsbExportTargetException>(() => UsbExportTarget.Require([device], Path.Combine(_root, "folder"), device.DeviceId));
        Assert.Throws<UsbExportTargetException>(() => UsbExportTarget.Require([device], _root, null));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Export_rechecks_target_and_preserves_existing_library_when_layout_changes(bool changedAfterCopy)
    {
        var target = Path.Combine(_root, "usb");
        Directory.CreateDirectory(Path.Combine(target, "PIONEER"));
        var original = Path.Combine(target, "PIONEER", "keep.txt");
        await File.WriteAllTextAsync(original, "original library");
        var source = Path.Combine(_root, "track.mp3");
        await File.WriteAllBytesAsync(source, [1, 2, 3]);
        var track = new Track { Id = Guid.NewGuid(), FilePath = source, FileName = "track.mp3", FileHash = "test", Duration = TimeSpan.FromSeconds(120) };
        var good = Device(target);
        var calls = 0;
        var devices = new FakeDevices(() => ++calls == 1 && changedAfterCopy ? [good] : [good with { PartitionStyle = "GPT" }]);
        var service = new PioneerUsbExportService(new PioneerDeviceLibraryWriter(), devices, new FakeWaveforms());
        await Assert.ThrowsAsync<UsbExportTargetException>(() => service.ExportAsync(target, "Test", [track], [new UsbPlaylist("Test", [track])], [], true,
            CancellationToken.None, good.DeviceId));
        Assert.Equal(changedAfterCopy ? 2 : 1, calls);
        Assert.Equal("original library", await File.ReadAllTextAsync(original));
        Assert.False(Directory.Exists(Path.Combine(target, "Contents")));
        Assert.Empty(Directory.GetDirectories(target, ".wisp-pioneer-staging-*"));
        Assert.False(Directory.Exists(Path.Combine(target, "WISP", "backups")));
    }

    private sealed class FakeDevices(Func<IReadOnlyList<UsbExportDevice>> list) : IUsbExportDevices
    {
        public Task<IReadOnlyList<UsbExportDevice>> ListAsync(CancellationToken ct) => Task.FromResult(list());
    }

    private sealed class FakeWaveforms : IPioneerWaveformAnalyzer
    {
        public Task<PioneerWaveform> AnalyzeAsync(string path, CancellationToken ct) =>
            Task.FromResult(new PioneerWaveform(new byte[400], new byte[100], 44100, DateTimeOffset.UtcNow));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }
}
