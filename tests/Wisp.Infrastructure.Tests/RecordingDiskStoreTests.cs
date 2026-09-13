using System.Diagnostics;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using Wisp.Infrastructure.Audio;

namespace Wisp.Infrastructure.Tests;

public sealed class RecordingDiskStoreTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "wisp-recording-disk-" + Guid.NewGuid().ToString("N"));
    private readonly RecordingDiskStore disk = new();

    [Theory]
    [InlineData(0L, "RIFF")]
    [InlineData(4294967200L, "RIFF")]
    [InlineData(4294967208L, "RIFF")]
    [InlineData(4294967216L, "RF64")]
    [InlineData(8589934592L, "RF64")]
    public void Header_sizes_cross_four_GiB_without_overflow(long bytes, string tag)
    {
        var header = RecordingDiskStore.Header(44100, bytes);
        Assert.Equal(92, header.Length); Assert.Equal(tag, Encoding.ASCII.GetString(header, 0, 4));
        Assert.Equal("data", Encoding.ASCII.GetString(header, 84, 4));
        if (tag == "RF64")
        {
            Assert.Equal("ds64", Encoding.ASCII.GetString(header, 12, 4));
            Assert.Equal(bytes + 84, BitConverter.ToInt64(header, 20));
            Assert.Equal(bytes, BitConverter.ToInt64(header, 28));
            Assert.Equal(bytes / 8, BitConverter.ToInt64(header, 36));
            Assert.Equal(uint.MaxValue, BitConverter.ToUInt32(header, 4));
            Assert.Equal(uint.MaxValue, BitConverter.ToUInt32(header, 80));
            Assert.Equal(uint.MaxValue, BitConverter.ToUInt32(header, 88));
        }
    }

    [Fact]
    public async Task Sparse_RF64_over_four_GiB_is_finalised_and_decoded_by_FFmpeg()
    {
        var ffmpeg = Environment.GetEnvironmentVariable("WISP_TEST_FFMPEG");
        if (string.IsNullOrWhiteSpace(ffmpeg)) return; // Enabled in documented full verification.
        var id = Guid.NewGuid(); var dir = disk.NewDirectory(root, id); const long bytes = 4294967296;
        using (var audio = (FileStream)disk.CreateAudio(dir))
        {
            if (OperatingSystem.IsWindows())
            {
                // Mark only the owned test file sparse, so this boundary test does
                // not fill the user's disk with four GiB of zeros.
                Assert.True(DeviceIoControl(audio.SafeFileHandle, 0x900c4, IntPtr.Zero, 0, IntPtr.Zero, 0, out _, IntPtr.Zero),
                    $"Could not mark owned test file sparse: {Marshal.GetLastWin32Error()}");
            }
            audio.SetLength(RecordingDiskStore.HeaderBytes + bytes); audio.Position = audio.Length;
            disk.Checkpoint(dir, audio, new(1, id, 44100, bytes, "Finalising", null, DateTime.UtcNow));
        }
        var output = disk.Promote(dir); RecordingDiskStore.Validate(output, 44100, bytes);
        var start = new ProcessStartInfo(ffmpeg) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true };
        foreach (var arg in new[] { "-v", "error", "-i", output, "-t", "0.01", "-f", "null", "-" }) start.ArgumentList.Add(arg);
        using var decode = Process.Start(start)!; var error = await decode.StandardError.ReadToEndAsync();
        await decode.WaitForExitAsync(); Assert.True(decode.ExitCode == 0, error);
        // Independent reader must also seek near the end using ds64 sizes.
        start.ArgumentList.Clear();
        foreach (var arg in new[] { "-v", "error", "-ss", "12173", "-i", output, "-t", "0.01", "-f", "null", "-" }) start.ArgumentList.Add(arg);
        using var seek = Process.Start(start)!; error = await seek.StandardError.ReadToEndAsync();
        await seek.WaitForExitAsync(); Assert.True(seek.ExitCode == 0, error);
    }

    [Fact]
    public void Recover_ignores_torn_header_and_uncommitted_tail_but_never_guesses_missing_audio()
    {
        var id = Guid.NewGuid(); var dir = disk.NewDirectory(root, id);
        using (var audio = disk.CreateAudio(dir))
        {
            audio.Write(new byte[92 + 64000]);
            disk.Checkpoint(dir, audio, new(1, id, 8000, 64000, "Recording", null, DateTime.UtcNow));
            audio.Write(new byte[4000]); audio.Position = 0; audio.Write(Encoding.ASCII.GetBytes("TORN")); disk.Flush(audio);
        }
        Assert.Equal(64000, disk.Recover(dir, id, 8000).AudioBytes);
        RecordingDiskStore.Validate(Path.Combine(dir, "master.wav"), 8000, 64000);
        Assert.Throws<IOException>(() => disk.Recover(dir, Guid.NewGuid(), 8000));
    }

    [Fact]
    public void Truncated_checkpoint_audio_is_retained_not_silently_repaired()
    {
        var id = Guid.NewGuid(); var dir = disk.NewDirectory(root, id);
        using (var audio = disk.CreateAudio(dir))
        {
            audio.Write(new byte[100]); disk.Flush(audio);
            disk.WriteManifest(dir, new(1, id, 8000, 64000, "Recording", null, DateTime.UtcNow));
        }
        var path = Path.Combine(dir, "master.wav.partial"); var before = File.ReadAllBytes(path);
        Assert.Throws<IOException>(() => disk.Recover(dir, id, 8000)); Assert.Equal(before, File.ReadAllBytes(path));
    }

    [Fact]
    public void Existing_output_never_overwritten_and_corrupt_manifest_never_rewrites_audio()
    {
        var id = Guid.NewGuid(); var dir = disk.NewDirectory(root, id);
        File.WriteAllText(Path.Combine(dir, "master.wav"), "keep");
        File.WriteAllText(Path.Combine(dir, "master.wav.partial"), "partial");
        Assert.Throws<IOException>(() => disk.Promote(dir));
        File.WriteAllText(Path.Combine(dir, "session.json"), "broken");
        Assert.Throws<System.Text.Json.JsonException>(() => disk.Recover(dir, id, 8000));
        Assert.Equal("keep", File.ReadAllText(Path.Combine(dir, "master.wav")));
        Assert.Equal("partial", File.ReadAllText(Path.Combine(dir, "master.wav.partial")));
    }

    [Fact]
    public async Task Killed_writer_process_recovers_checkpoint_without_a_graceful_close()
    {
        Directory.CreateDirectory(root);
        var start = new ProcessStartInfo("dotnet") { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add("vstest"); start.ArgumentList.Add(typeof(RecordingDiskStoreTests).Assembly.Location);
        start.ArgumentList.Add("/TestCaseFilter:FullyQualifiedName~CrashWriterFixture");
        start.Environment["WISP_CRASH_FIXTURE"] = root;
        using var child = Process.Start(start)!;
        var stdout = child.StandardOutput.ReadToEndAsync(); var stderr = child.StandardError.ReadToEndAsync();
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            var signal = Path.Combine(root, "ready");
            while (!File.Exists(signal))
            {
                Assert.False(child.HasExited, "Crash fixture exited before writing its checkpoint.");
                await Task.Delay(30, timeout.Token);
            }
            var id = Guid.Parse(await File.ReadAllTextAsync(signal));
            child.Kill(entireProcessTree: true); await child.WaitForExitAsync();
            var dir = Path.Combine(root, RecordingDiskStore.FolderName, id.ToString("D"));
            // Waiting for dotnet itself does not guarantee its killed testhost
            // descendant has released all Windows file handles yet.
            while (true)
            {
                try { using var unlocked = new FileStream(Path.Combine(dir, "master.wav.partial"), FileMode.Open, FileAccess.Read, FileShare.None); break; }
                catch (IOException ex) when ((ex.HResult & 0xffff) == 32) { await Task.Delay(20, timeout.Token); }
            }
            Assert.Equal(64000, disk.Recover(dir, id, 8000).AudioBytes);
            RecordingDiskStore.Validate(Path.Combine(dir, "master.wav"), 8000, 64000);
        }
        finally
        {
            if (!child.HasExited) { child.Kill(entireProcessTree: true); await child.WaitForExitAsync(); }
            await stdout; await stderr;
        }
    }

    // Launched only by the parent kill/recovery test; never touches a live profile.
    [Fact]
    public async Task CrashWriterFixture()
    {
        var target = Environment.GetEnvironmentVariable("WISP_CRASH_FIXTURE");
        if (string.IsNullOrWhiteSpace(target)) return;
        var id = Guid.NewGuid(); var dir = disk.NewDirectory(target, id);
        using var output = disk.CreateAudio(dir);
        output.Write(new byte[92 + 64000]);
        disk.Checkpoint(dir, output, new(1, id, 8000, 64000, "Recording", null, DateTime.UtcNow));
        output.Write(new byte[32000]); disk.Flush(output); // written but not checkpointed
        await File.WriteAllTextAsync(Path.Combine(target, "ready.tmp"), id.ToString("D"));
        File.Move(Path.Combine(target, "ready.tmp"), Path.Combine(target, "ready"));
        await Task.Delay(TimeSpan.FromSeconds(60)); // parent kills this owned child first
    }

    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, true); }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeviceIoControl(SafeFileHandle handle, uint code, IntPtr input, int inputBytes,
        IntPtr output, int outputBytes, out int returned, IntPtr overlapped);
}
