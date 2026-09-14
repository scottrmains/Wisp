using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Wisp.Infrastructure.Usb;

public sealed record UsbExportDevice(string DeviceId, string RootPath, string Label, string Model,
    long SizeBytes, long FreeBytes, string FileSystem, string PartitionStyle, int PartitionCount,
    bool IsReadOnly, bool IsSystem, string BusType)
{
    public string? CompatibilityProblem =>
        BusType != "USB" || IsSystem ? "System and internal disks cannot be used for CDJ export." :
        IsReadOnly ? "This USB is read-only. Unlock it before exporting." :
        PartitionStyle != "MBR" ? "This USB uses GPT or an unknown partition layout. CDJ-850/900 export requires MBR with one FAT32 partition. Formatting a drive letter alone does not change GPT. Back up the USB before repartitioning it." :
        PartitionCount != 1 ? "This USB has multiple partitions. Use one MBR/FAT32 partition for this CDJ profile. Back up the whole USB before changing its partitions." :
        FileSystem is not ("FAT32" or "FAT" or "FAT16") ? "This filesystem is not supported by the WISP CDJ-850/900 profile. Use FAT32; back up your files before formatting." :
        SizeBytes <= 0 ? "The USB volume is not ready. Reconnect it and refresh." : null;
    public bool CanExport => CompatibilityProblem is null;
}

public interface IUsbExportDevices
{
    Task<IReadOnlyList<UsbExportDevice>> ListAsync(CancellationToken ct);
}

/// <summary>
/// Windows Storage inventory, not DriveType.Removable (which misses USB SSDs).
/// The fixed script only reads disk/partition/volume properties, never formats,
/// mounts or writes. No user input is interpolated into the shell command.
/// </summary>
public sealed class WindowsUsbExportDevices : IUsbExportDevices
{
    private const string InventoryScript = """
        $ErrorActionPreference = 'Stop'
        [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        $items = @(foreach ($disk in (Get-Disk | Where-Object { $_.BusType -eq 'USB' -and -not $_.IsBoot -and -not $_.IsSystem -and -not $_.IsOffline })) {
            $parts = @(Get-Partition -DiskNumber $disk.Number)
            $part = $parts | Where-Object { $_.DriveLetter } | Sort-Object Size -Descending | Select-Object -First 1
            if ($null -eq $part) { continue }
            $volume = Get-Volume -DriveLetter $part.DriveLetter
            [pscustomobject]@{
                Identity = "$($disk.UniqueId)|$($disk.SerialNumber)|$($disk.Number)|$($part.Offset)|$($part.Guid)|$($volume.UniqueId)"
                RootPath = "$($part.DriveLetter):\"
                Label = [string]$volume.FileSystemLabel
                Model = [string]$disk.FriendlyName
                SizeBytes = [long]$volume.Size
                FreeBytes = [long]$volume.SizeRemaining
                FileSystem = [string]$volume.FileSystem
                PartitionStyle = [string]$disk.PartitionStyle
                PartitionCount = $parts.Count
                IsReadOnly = [bool]($disk.IsReadOnly -or $part.IsReadOnly)
            }
        })
        ConvertTo-Json -InputObject $items -Compress
        """;

    private readonly SemaphoreSlim _inventoryGate = new(1, 1);

    public async Task<IReadOnlyList<UsbExportDevice>> ListAsync(CancellationToken ct)
    {
        if (!OperatingSystem.IsWindows()) throw new IOException("USB detection is currently available in the Windows desktop app.");
        await _inventoryGate.WaitAsync(ct);
        try
        {
            var info = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                "WindowsPowerShell", "v1.0", "powershell.exe"))
            {
                UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8,
            };
            foreach (var argument in new[] { "-NoProfile", "-NonInteractive", "-EncodedCommand", Convert.ToBase64String(Encoding.Unicode.GetBytes(InventoryScript)) })
                info.ArgumentList.Add(argument);
            using var process = Process.Start(info) ?? throw new IOException("Windows USB detection could not start.");
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(15));
            try
            {
                var stdout = process.StandardOutput.ReadToEndAsync(timeout.Token);
                var stderr = process.StandardError.ReadToEndAsync(timeout.Token);
                await process.WaitForExitAsync(timeout.Token);
                var json = await stdout;
                _ = await stderr;
                if (process.ExitCode != 0) throw new IOException("Windows could not inspect USB disks. Reconnect the USB and refresh. No drive was changed.");
                var rows = JsonSerializer.Deserialize<List<InventoryRow>>(json) ?? [];
                return rows.Select(row => new UsbExportDevice(
                    Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(row.Identity))),
                    row.RootPath, string.IsNullOrWhiteSpace(row.Label) ? "Unnamed USB" : row.Label,
                    row.Model, row.SizeBytes, row.FreeBytes, row.FileSystem.ToUpperInvariant(), row.PartitionStyle.ToUpperInvariant(),
                    row.PartitionCount, row.IsReadOnly, false, "USB")).OrderBy(d => d.RootPath).ToList();
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                throw new IOException("USB detection timed out. Reconnect the USB and refresh. No drive was changed.");
            }
            finally
            {
                if (!process.HasExited) process.Kill(entireProcessTree: true);
            }
        }
        finally { _inventoryGate.Release(); }
    }

    private sealed record InventoryRow(string Identity, string RootPath, string Label, string Model,
        long SizeBytes, long FreeBytes, string FileSystem, string PartitionStyle, int PartitionCount, bool IsReadOnly);
}

public static class UsbExportTarget
{
    public static UsbExportDevice Require(IReadOnlyList<UsbExportDevice> devices, string targetRoot, string? deviceId)
    {
        var root = Path.GetFullPath(targetRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var device = devices.FirstOrDefault(d => d.RootPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            .Equals(root, StringComparison.OrdinalIgnoreCase));
        if (device is null) throw new UsbExportTargetException("The selected USB is no longer connected or is not a USB root. Refresh and select a connected USB.");
        if (string.IsNullOrWhiteSpace(deviceId) || device.DeviceId != deviceId)
            throw new UsbExportTargetException("The USB selection changed. Refresh and select the device again before exporting.");
        if (!device.CanExport) throw new UsbExportTargetException(device.CompatibilityProblem!);
        return device;
    }
}

public sealed class UsbExportTargetException(string message) : InvalidOperationException(message);
