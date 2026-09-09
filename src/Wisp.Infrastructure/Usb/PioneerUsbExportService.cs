using System.Text.Json;
using Wisp.Core.Cues;
using Wisp.Core.Tracks;

namespace Wisp.Infrastructure.Usb;

/// <summary>
/// Transactional installer for a Wisp-owned conventional Pioneer library. All
/// audio and database work happens in a sibling staging directory first. The
/// existing Pioneer library is never touched unless the caller explicitly
/// confirms replacement, and is then moved into a dated Wisp backup.
/// </summary>
public sealed class PioneerUsbExportService(PioneerDeviceLibraryWriter writer)
{
    // Playlist insertion and audio loading now pass on a CDJ-850 using the
    // accepted template. The next isolated hardware step is Wisp's PCOB
    // Memory Cue / loop analysis sidecar for those same appended tracks.
    private const bool CatalogueOnlyHardwareValidation = false;
    private static readonly HashSet<string> SupportedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp3", ".m4a", ".aac", ".wav", ".aiff", ".aif",
    };

    public async Task<PioneerUsbExportResult> ExportAsync(
        string targetRoot,
        string collectionName,
        IReadOnlyList<Track> tracks,
        IReadOnlyList<UsbPlaylist> playlists,
        IReadOnlyList<DeviceCue> deviceCues,
        bool confirmReplaceExistingPioneerLibrary,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(targetRoot)) throw new ArgumentException("A USB target folder is required.");
        if (!Directory.Exists(targetRoot)) throw new DirectoryNotFoundException($"USB target does not exist: {targetRoot}");
        var root = Path.GetFullPath(targetRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var pioneer = Path.Combine(root, "PIONEER");
        if (Directory.Exists(pioneer) && !confirmReplaceExistingPioneerLibrary)
            throw new PioneerLibraryExistsException("This USB already has a Pioneer library. Review the preflight and explicitly confirm replacement; Wisp will first back it up under WISP/backups.");

        var selected = tracks.DistinctBy(t => t.Id).ToList();
        if (selected.Count == 0) throw new ArgumentException("Add at least one available track before exporting.");
        var unavailable = selected.Where(t => t.IsUnavailable || !File.Exists(t.FilePath)).ToList();
        if (unavailable.Count > 0) throw new InvalidOperationException($"{unavailable.Count} selected track(s) are missing from disk and cannot be exported.");
        var unsupported = selected.Where(t => !SupportedExtensions.Contains(Path.GetExtension(t.FileName))).ToList();
        if (unsupported.Count > 0) throw new UnsupportedPioneerFormatException($"{unsupported.Count} track(s) are not supported by the CDJ-850 profile. Convert them to MP3, AAC, WAV or AIFF first.");

        var staging = Path.Combine(root, $".wisp-pioneer-staging-{Guid.NewGuid():N}");
        var backupRoot = Path.Combine(root, "WISP", "backups");
        string? pioneerBackup = null;
        string? contentsBackup = null;
        var installedPioneer = false;
        var installedContents = false;
        try
        {
            Directory.CreateDirectory(staging);
            var planned = CreateDeviceTracks(selected, deviceCues, includeAnalysis: !CatalogueOnlyHardwareValidation);
            foreach (var track in planned)
            {
                ct.ThrowIfCancellationRequested();
                var destination = Path.Combine(staging, track.ContentPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                await CopyFileAsync(track.Track.FilePath, destination, ct);
                File.SetLastWriteTimeUtc(destination, File.GetLastWriteTimeUtc(track.Track.FilePath));
            }

            var deviceIdByWispId = planned.ToDictionary(t => t.Track.Id, t => t.DeviceId);
            var exportPlaylists = playlists
                .Select((p, index) => new PioneerExportPlaylist(
                    index + 1,
                    p.Name,
                    p.Tracks.Where(t => deviceIdByWispId.ContainsKey(t.Id)).Select(t => deviceIdByWispId[t.Id]).ToList()))
                .Where(p => p.TrackIds.Count > 0)
                .ToList();
            PioneerLibraryWriteResult write;
            List<PioneerExportTrack> installedTracks;
            List<PioneerExportPlaylist> installedPlaylists;
            if (IsDriveRoot(root))
            {
                var templatePdb = FindPlayerAcceptedTemplate(root);
                // Keep this first physical compatibility pass unmistakable on
                // the player: the template itself can already contain a
                // playlist with the same name as the Wisp source.
                var templatePlaylists = exportPlaylists
                    .Select(playlist => playlist with { Name = $"WISP — {playlist.Name}" })
                    .ToList();
                write = writer.WriteFromTemplate(staging, templatePdb, planned, templatePlaylists);
                installedTracks = planned.Select(track => track with { DeviceId = write.TrackIdMap![track.DeviceId] }).ToList();
                installedPlaylists = templatePlaylists.Select(playlist => playlist with
                {
                    DeviceId = write.PlaylistIdMap![playlist.DeviceId],
                    TrackIds = playlist.TrackIds.Select(id => write.TrackIdMap![id]).ToList(),
                }).ToList();
            }
            else
            {
                // Folder exports remain useful for development and automated
                // validation. A real removable-drive export always takes the
                // accepted-template route above.
                write = writer.Write(staging, planned, exportPlaylists);
                installedTracks = planned;
                installedPlaylists = exportPlaylists;
            }
            PioneerDeviceLibraryValidator.Validate(
                write.PdbPath,
                installedTracks,
                installedPlaylists,
                allowAdditionalRows: write.TrackIdMap is not null,
                validateFreshPageLayout: write.TrackIdMap is null);

            // No target data is moved until staging has copied every audio file and passed the
            // PDB/ANLZ validator above.
            Directory.CreateDirectory(backupRoot);
            var stamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss");
            if (Directory.Exists(pioneer))
            {
                pioneerBackup = Path.Combine(backupRoot, $"PIONEER-{stamp}");
                Directory.Move(pioneer, pioneerBackup);
            }
            var existingWispContents = Path.Combine(root, "Contents", "WISP");
            if (Directory.Exists(existingWispContents))
            {
                contentsBackup = Path.Combine(backupRoot, $"Contents-WISP-{stamp}");
                Directory.Move(existingWispContents, contentsBackup);
            }

            var stagedContents = Path.Combine(staging, "Contents", "WISP");
            Directory.CreateDirectory(Path.Combine(root, "Contents"));
            Directory.Move(stagedContents, Path.Combine(root, "Contents", "WISP"));
            installedContents = true;
            Directory.Move(Path.Combine(staging, "PIONEER"), pioneer);
            installedPioneer = true;

            // Validate again at the installed path, not merely in staging. This
            // catches an incomplete directory move or an unexpected removable-
            // media filesystem outcome before the UI can report success.
            var installedPdb = Path.Combine(pioneer, "rekordbox", "export.pdb");
            PioneerDeviceLibraryValidator.Validate(
                installedPdb,
                installedTracks,
                installedPlaylists,
                allowAdditionalRows: write.TrackIdMap is not null,
                validateFreshPageLayout: write.TrackIdMap is null);

            var receipt = new PioneerExportReceipt(
                Version: 1,
                CollectionName: collectionName,
                ExportedAt: DateTimeOffset.UtcNow,
                TrackCount: planned.Count,
                PlaylistCount: exportPlaylists.Count,
                PioneerBackupPath: pioneerBackup,
                ContentsBackupPath: contentsBackup,
                Tracks: installedTracks.Select(t => new PioneerExportReceiptTrack(t.Track.Id, t.DeviceId, t.ContentPath, t.AnalysisPath, t.DeviceCues.Count)).ToList());
            var receiptPath = Path.Combine(root, "WISP", "pioneer-export-receipt.json");
            await File.WriteAllTextAsync(receiptPath, JsonSerializer.Serialize(receipt, new JsonSerializerOptions { WriteIndented = true }), ct);
            return new PioneerUsbExportResult(planned.Count, exportPlaylists.Count, installedPdb, receiptPath, pioneerBackup, contentsBackup);
        }
        catch
        {
            // Restore a moved library when installation fails. Each path is explicit and lives
            // directly beneath the selected root; no computed recursive delete touches user media.
            if (installedPioneer && Directory.Exists(pioneer)) Directory.Delete(pioneer, recursive: true);
            if (pioneerBackup is not null && Directory.Exists(pioneerBackup) && !Directory.Exists(pioneer)) Directory.Move(pioneerBackup, pioneer);
            var installedWispContents = Path.Combine(root, "Contents", "WISP");
            if (installedContents && Directory.Exists(installedWispContents)) Directory.Delete(installedWispContents, recursive: true);
            if (contentsBackup is not null && Directory.Exists(contentsBackup) && !Directory.Exists(installedWispContents)) Directory.Move(contentsBackup, installedWispContents);
            throw;
        }
        finally
        {
            if (Directory.Exists(staging)) Directory.Delete(staging, recursive: true);
        }
    }

    private static List<PioneerExportTrack> CreateDeviceTracks(IReadOnlyList<Track> tracks, IReadOnlyList<DeviceCue> cues, bool includeAnalysis)
    {
        return tracks.Select((track, index) =>
        {
            // This is a full replacement export, not an incremental merge: use
            // conventional dense DeviceSQL IDs, matching rekordbox's freshly
            // created-library allocation behaviour.
            var id = index + 1;
            var extension = Path.GetExtension(track.FileName);
            var artist = Sanitize(track.Artist ?? "Unknown Artist");
            var title = Sanitize(track.Title ?? Path.GetFileNameWithoutExtension(track.FileName));
            var suffix = track.Id.ToString("N")[..8];
            var contentPath = $"/Contents/WISP/{artist}/{title} [{suffix}]{extension}";
            var analysisPath = includeAnalysis ? $"/PIONEER/USBANLZ/P{id % 1000:000}/{id:X8}/ANLZ0000.DAT" : "";
            var selectedCues = includeAnalysis
                ? cues.Where(c => c.TrackId == track.Id).OrderBy(c => c.StartSeconds).ToList()
                : [];
            return new PioneerExportTrack(id, contentPath, analysisPath, track, selectedCues);
        }).ToList();
    }

    private static string FindPlayerAcceptedTemplate(string targetRoot)
    {
        var configured = Environment.GetEnvironmentVariable("WISP_PIONEER_TEMPLATE");
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return Path.GetFullPath(configured);

        var target = Path.GetFullPath(targetRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var candidates = DriveInfo.GetDrives()
            .Where(drive => drive.IsReady)
            .Select(drive => Path.Combine(drive.RootDirectory.FullName, "PIONEER", "rekordbox", "export.pdb"))
            .Where(File.Exists)
            .Select(Path.GetFullPath)
            .Where(path => !path.StartsWith(target + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            .Where(path => new FileInfo(path).Length >= 4096)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (candidates.Count == 1) return candidates[0];
        if (candidates.Count == 0)
            throw new PioneerTemplateRequiredException("Connect a separate USB exported by rekordbox so Wisp can use its player-accepted Pioneer database as a read-only template.");
        throw new PioneerTemplateRequiredException("More than one Pioneer database template was found. Set WISP_PIONEER_TEMPLATE to the exact export.pdb file Wisp should read.");
    }

    private static bool IsDriveRoot(string path)
    {
        var driveRoot = Path.GetPathRoot(path);
        return driveRoot is not null && string.Equals(
            path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
            driveRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
            StringComparison.OrdinalIgnoreCase);
    }


    private static async Task CopyFileAsync(string source, string destination, CancellationToken ct)
    {
        await using var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read, 128 * 1024, FileOptions.SequentialScan);
        await using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        await input.CopyToAsync(output, 128 * 1024, ct);
        await output.FlushAsync(ct);
    }

    private static string Sanitize(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var clean = string.Concat(value.Where(c => !invalid.Contains(c) && !char.IsControl(c))).Trim().TrimEnd('.');
        return string.IsNullOrWhiteSpace(clean) ? "Untitled" : clean;
    }
}

public sealed class PioneerLibraryExistsException(string message) : InvalidOperationException(message);
public sealed class UnsupportedPioneerFormatException(string message) : InvalidOperationException(message);
public sealed class PioneerTemplateRequiredException(string message) : InvalidOperationException(message);
public sealed record PioneerUsbExportResult(int TrackCount, int PlaylistCount, string StagedPdbPath, string ReceiptPath, string? PioneerBackupPath, string? ContentsBackupPath);
public sealed record PioneerExportReceipt(int Version, string CollectionName, DateTimeOffset ExportedAt, int TrackCount, int PlaylistCount, string? PioneerBackupPath, string? ContentsBackupPath, IReadOnlyList<PioneerExportReceiptTrack> Tracks);
public sealed record PioneerExportReceiptTrack(Guid TrackId, int DeviceId, string ContentPath, string AnalysisPath, int MemoryCueCount);
