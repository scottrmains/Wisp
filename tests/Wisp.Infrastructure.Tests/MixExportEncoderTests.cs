using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Win32.SafeHandles;
using Wisp.Infrastructure.Audio;

namespace Wisp.Infrastructure.Tests;

public sealed class MixExportEncoderTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "wisp-export-encoder-" + Guid.NewGuid().ToString("N"));
    public MixExportEncoderTests() => Directory.CreateDirectory(root);
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Full_short_and_sparse_large_RF64_exports_decode_to_stereo_320_CBR(bool large)
    {
        var ffmpeg = Environment.GetEnvironmentVariable("WISP_TEST_FFMPEG"); if (string.IsNullOrWhiteSpace(ffmpeg)) return;
        // 46+ minute synthetic stereo fixture crosses 4 GiB without allocating it on disk.
        int rate = large ? 192000 : 48000; long bytes = large ? 4294967296L : rate * 8L * 180;
        var source = Path.Combine(root, "source.wav"); var output = Path.Combine(root, "mix.mp3");
        using (var file = new FileStream(source, FileMode.CreateNew, FileAccess.Write))
        {
            if (OperatingSystem.IsWindows()) Assert.True(DeviceIoControl(file.SafeFileHandle, 0x900c4, IntPtr.Zero, 0, IntPtr.Zero, 0, out _, IntPtr.Zero));
            file.SetLength(RecordingDiskStore.HeaderBytes + bytes); file.Write(RecordingDiskStore.Header(rate, bytes)); file.Flush(true);
        }
        var encoder = new MixExportEncoder(new(NullLogger<Mp3Transcoder>.Instance, () => ffmpeg));
        double progress = 0; using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(5));
        await encoder.Encode(source, output, "mp3", rate, bytes, "Long stereo mix", new(2026, 9, 13), p => progress = p, () => { }, timeout.Token);
        Assert.True(progress >= .94); MixExportEncoder.ValidateMp3(output); RecordingDiskStore.Validate(source, rate, bytes);
        Assert.InRange(new FileInfo(output).Length, (long)(bytes / (rate * 8d) * 40000), (long)(bytes / (rate * 8d) * 40000) + 10000);
    }
    [Fact]
    public async Task Broken_executable_reports_settings_repair_without_touching_source()
    {
        var executable = Path.Combine(root, "invalid.exe"); await File.WriteAllTextAsync(executable, "Not executable");
        var source = Path.Combine(root, "source.wav"); await File.WriteAllBytesAsync(source, RecordingDiskStore.Header(8000, 0));
        var encoder = new MixExportEncoder(new(NullLogger<Mp3Transcoder>.Instance, () => executable));
        var error = await Assert.ThrowsAsync<IOException>(() => encoder.Encode(source, Path.Combine(root, "out.mp3"), "mp3", 8000, 8000, "Mix", DateTime.UtcNow, _ => { }, () => { }, default));
        Assert.Contains("Settings", error.Message); Assert.Equal(RecordingDiskStore.Header(8000, 0), await File.ReadAllBytesAsync(source));
    }
    [Fact]
    public async Task Cancelling_real_encoder_kills_process_and_releases_files()
    {
        var ffmpeg = Environment.GetEnvironmentVariable("WISP_TEST_FFMPEG"); if (string.IsNullOrWhiteSpace(ffmpeg)) return;
        var source = Path.Combine(root, "source.wav"); var output = Path.Combine(root, "mix.mp3"); const long bytes = 48000 * 8L * 120;
        using (var file = new FileStream(source, FileMode.CreateNew, FileAccess.Write)) { file.SetLength(92 + bytes); file.Write(RecordingDiskStore.Header(48000, bytes)); }
        var encoder = new MixExportEncoder(new(NullLogger<Mp3Transcoder>.Instance, () => ffmpeg)); using var ct = new CancellationTokenSource();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => encoder.Encode(source, output, "mp3", 48000, bytes, "Cancel", DateTime.UtcNow,
            p => { if (p > 0) ct.Cancel(); }, () => { }, ct.Token));
        using var unlocked = new FileStream(output, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        RecordingDiskStore.Validate(source, 48000, bytes);
    }
    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, true); }
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeviceIoControl(SafeFileHandle handle, uint code, IntPtr input, int inputBytes, IntPtr output, int outputBytes, out int returned, IntPtr overlapped);
}
