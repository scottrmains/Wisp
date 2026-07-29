using System.Text.Json;
using Wisp.Core.Tracks;

namespace Wisp.Infrastructure.Usb;

/// <summary>
/// Copies Wisp tracks to a removable-volume folder without touching any files
/// outside WISP's own directories on that target. It deliberately does not
/// pretend to generate Pioneer Device Library data; that requires a verified
/// writer and hardware test matrix.
/// </summary>
public sealed class UsbFileSync
{
    public async Task<UsbSyncResult> SyncAsync(
        string targetRoot,
        string collectionName,
        IReadOnlyList<Track> tracks,
        IReadOnlyList<UsbPlaylist> playlists,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(targetRoot)) throw new ArgumentException("A USB target folder is required.");
        if (!Directory.Exists(targetRoot)) throw new DirectoryNotFoundException($"USB target does not exist: {targetRoot}");

        var root = Path.GetFullPath(targetRoot);
        var contents = Path.Combine(root, "Contents");
        var wispDir = Path.Combine(root, "WISP");
        var playlistDir = Path.Combine(wispDir, "playlists");
        Directory.CreateDirectory(contents);
        Directory.CreateDirectory(playlistDir);

        var copied = 0;
        var skipped = 0;
        var bytesCopied = 0L;
        var paths = new Dictionary<Guid, string>();

        foreach (var track in tracks.DistinctBy(t => t.Id))
        {
            ct.ThrowIfCancellationRequested();
            if (track.IsUnavailable || !File.Exists(track.FilePath)) continue;

            var relative = MakeTrackPath(track);
            var destination = Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar));
            EnsureWithinRoot(root, destination);
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);

            var sourceInfo = new FileInfo(track.FilePath);
            var destinationInfo = new FileInfo(destination);
            if (destinationInfo.Exists && destinationInfo.Length == sourceInfo.Length && destinationInfo.LastWriteTimeUtc >= sourceInfo.LastWriteTimeUtc)
            {
                skipped++;
            }
            else
            {
                // Never leave a half-copied track that could be selected by a
                // player: copy beside the final file, then atomically replace.
                var temporary = destination + ".wisp-copying";
                try
                {
                    await using (var source = new FileStream(track.FilePath, FileMode.Open, FileAccess.Read, FileShare.Read, 128 * 1024, FileOptions.SequentialScan))
                    await using (var target = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, 128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan))
                    {
                        await source.CopyToAsync(target, 128 * 1024, ct);
                        await target.FlushAsync(ct);
                    }
                    File.Move(temporary, destination, overwrite: true);
                    File.SetLastWriteTimeUtc(destination, sourceInfo.LastWriteTimeUtc);
                }
                finally
                {
                    if (File.Exists(temporary)) File.Delete(temporary);
                }
                copied++;
                bytesCopied += sourceInfo.Length;
            }

            paths[track.Id] = relative;
        }

        foreach (var playlist in playlists)
        {
            ct.ThrowIfCancellationRequested();
            var file = Path.Combine(playlistDir, Sanitize(playlist.Name) + ".m3u8");
            var lines = new List<string> { "#EXTM3U", $"#PLAYLIST:{playlist.Name}" };
            foreach (var track in playlist.Tracks)
            {
                if (!paths.TryGetValue(track.Id, out var relative)) continue;
                var artist = track.Artist ?? "Unknown";
                var title = track.Title ?? Path.GetFileNameWithoutExtension(track.FileName);
                lines.Add($"#EXTINF:{(int)Math.Round(track.Duration.TotalSeconds)},{artist} - {title}");
                // M3U paths are relative to WISP/playlists/.
                lines.Add("../../" + relative);
            }
            await File.WriteAllLinesAsync(file, lines, ct);
        }

        var manifest = new UsbSyncManifest(
            Version: 1,
            CollectionName: collectionName,
            SyncedAt: DateTimeOffset.UtcNow,
            Tracks: tracks.Where(t => paths.ContainsKey(t.Id)).Select(t => new UsbSyncManifestTrack(
                t.Id, t.FileHash, paths[t.Id], t.Artist, t.Title, t.Bpm, t.MusicalKey)).ToList());
        await File.WriteAllTextAsync(
            Path.Combine(wispDir, "sync-manifest.json"),
            JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }), ct);

        return new UsbSyncResult(copied, skipped, bytesCopied, paths.Count, Path.Combine(wispDir, "sync-manifest.json"));
    }

    private static string MakeTrackPath(Track track)
    {
        var artist = Sanitize(track.Artist ?? "Unknown Artist");
        var title = Sanitize(track.Title ?? Path.GetFileNameWithoutExtension(track.FileName));
        var extension = Path.GetExtension(track.FileName);
        if (string.IsNullOrEmpty(extension)) extension = Path.GetExtension(track.FilePath);
        var suffix = track.Id.ToString("N")[..8];
        return $"Contents/{artist}/{title} [{suffix}]{extension}";
    }

    private static string Sanitize(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var clean = string.Concat(value.Where(c => !invalid.Contains(c) && !char.IsControl(c))).Trim().TrimEnd('.');
        return string.IsNullOrWhiteSpace(clean) ? "Untitled" : clean;
    }

    private static void EnsureWithinRoot(string root, string path)
    {
        var relative = Path.GetRelativePath(root, path);
        if (Path.IsPathRooted(relative) || relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal) || relative == "..")
            throw new InvalidOperationException("Refusing to copy outside the selected USB target.");
    }
}

public sealed record UsbPlaylist(string Name, IReadOnlyList<Track> Tracks);
public sealed record UsbSyncResult(int Copied, int Skipped, long BytesCopied, int TrackCount, string ManifestPath);
public sealed record UsbSyncManifest(int Version, string CollectionName, DateTimeOffset SyncedAt, IReadOnlyList<UsbSyncManifestTrack> Tracks);
public sealed record UsbSyncManifestTrack(Guid TrackId, string FileHash, string RelativePath, string? Artist, string? Title, decimal? Bpm, string? MusicalKey);
