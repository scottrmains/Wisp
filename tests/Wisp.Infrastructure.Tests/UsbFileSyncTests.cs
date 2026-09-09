using Wisp.Core.Tracks;
using Wisp.Infrastructure.Usb;

namespace Wisp.Infrastructure.Tests;

public sealed class UsbFileSyncTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wisp-usb-" + Guid.NewGuid().ToString("N"));

    public UsbFileSyncTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        try { Directory.Delete(_root, recursive: true); } catch { /* best effort */ }
    }

    [Fact]
    public async Task Sync_copies_tracks_writes_relative_playlist_and_skips_unchanged_files()
    {
        var source = Path.Combine(_root, "source", "Artist - Track.mp3");
        Directory.CreateDirectory(Path.GetDirectoryName(source)!);
        await File.WriteAllBytesAsync(source, [1, 2, 3, 4]);
        var target = Path.Combine(_root, "usb");
        Directory.CreateDirectory(target);
        var track = new Track
        {
            Id = Guid.NewGuid(),
            FilePath = source,
            FileName = Path.GetFileName(source),
            FileHash = "hash",
            Artist = "Artist",
            Title = "Track",
            Bpm = 124,
            Duration = TimeSpan.FromSeconds(180),
        };

        var sync = new UsbFileSync();
        var first = await sync.SyncAsync(target, "Warmup", [track], [new UsbPlaylist("Warmup", [track])], CancellationToken.None);
        var second = await sync.SyncAsync(target, "Warmup", [track], [new UsbPlaylist("Warmup", [track])], CancellationToken.None);

        Assert.Equal(1, first.Copied);
        Assert.Equal(1, second.Skipped);
        Assert.True(File.Exists(first.ManifestPath));
        var playlist = await File.ReadAllTextAsync(Path.Combine(target, "WISP", "playlists", "Warmup.m3u8"));
        Assert.Contains("../../Contents/Artist/Track", playlist);
        Assert.DoesNotContain(source, playlist, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Sync_skips_unavailable_tracks()
    {
        var target = Path.Combine(_root, "usb");
        Directory.CreateDirectory(target);
        var track = new Track
        {
            Id = Guid.NewGuid(),
            FilePath = Path.Combine(_root, "missing.mp3"),
            FileName = "missing.mp3",
            FileHash = "hash",
            IsUnavailable = true,
        };

        var result = await new UsbFileSync().SyncAsync(target, "Empty", [track], [new UsbPlaylist("Empty", [track])], CancellationToken.None);

        Assert.Equal(0, result.TrackCount);
        Assert.Equal(0, result.Copied);
    }
}
