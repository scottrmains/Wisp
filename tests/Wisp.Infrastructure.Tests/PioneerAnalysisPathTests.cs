using System.Buffers.Binary;
using System.Text;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Usb;

namespace Wisp.Infrastructure.Tests;

public sealed class PioneerAnalysisPathTests
{
    // Two independently matching published rekordbox vectors, not values emitted
    // by Wisp's writer. The source's third (Huerta) example disagrees with its
    // own algorithm, so it is not treated as a reliable oracle.
    [Theory]
    [InlineData("/Contents/Leo Portela/Bon Vibrant - Leo Portela.flac", "P00E/000281CE")]
    [InlineData("/Contents/Daniela Cast/Jazzy - Daniela Cast.flac", "P00A/0000CC9C")]
    // UTF-16 code-unit/uint32-overflow check independently computed in PowerShell.
    [InlineData("/Contents/Test/🎵 café.mp3", "P03B/0002FB8F")]
    public void Audio_path_hash_matches_known_directory(string audioPath, string folder) =>
        Assert.Equal("/PIONEER/USBANLZ/" + folder + "/ANLZ0000.DAT", PioneerAnalysisPath.ForAudio(audioPath));

    [Theory]
    [InlineData("")]
    [InlineData("relative.mp3")]
    [InlineData("/Contents\\track.mp3")]
    [InlineData("/Contents/track\0.mp3")]
    public void Invalid_paths_are_not_silently_normalized(string path) =>
        Assert.Throws<ArgumentException>(() => PioneerAnalysisPath.ForAudio(path));

    [Fact]
    public void Real_hash_collision_is_rejected_instead_of_overwriting_analysis()
    {
        var first = ExportTrack("/Contents/Test/294.mp3", 1);
        var second = ExportTrack("/Contents/Test/3909.mp3", 2);
        Assert.Equal(first.AnalysisPath, second.AnalysisPath);
        Assert.Equal("/PIONEER/USBANLZ/P026/00007C4C/ANLZ0000.DAT", first.AnalysisPath);
        Assert.Throws<PioneerWaveformException>(() => PioneerAnalysisPath.RequireDistinct([first, second]));
    }

    [Fact]
    public void Correct_pdb_links_are_insufficient_if_waveform_is_in_old_id_based_folder()
    {
        var root = Path.Combine(Path.GetTempPath(), "wisp-path-rejection-" + Guid.NewGuid().ToString("N"));
        try
        {
            var track = ExportTrack("/Contents/Test/test.mp3", 1) with
            {
                AnalysisPath = "/PIONEER/USBANLZ/P001/00000001/ANLZ0000.DAT",
                Waveform = new(new byte[400], new byte[100], 44100, DateTimeOffset.UtcNow),
            };
            var error = Assert.Throws<InvalidOperationException>(() => new PioneerDeviceLibraryWriter().Write(root, [track], []));
            Assert.Contains("player lookup", error.Message);
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Theory]
    [InlineData("WISP_PIONEER_ANLZ_DIR", "ANLZ0000.DAT")]
    [InlineData("WISP_TEST_CDJ_PLAYER_DIR", "ANLZ0001.DAT")]
    public void Optional_rekordbox_and_player_created_directories_match_exact_audio_path_hash(string variable, string pattern)
    {
        var root = Environment.GetEnvironmentVariable(variable);
        if (string.IsNullOrWhiteSpace(root)) return;
        var files = Directory.GetFiles(root, pattern, SearchOption.AllDirectories);
        Assert.NotEmpty(files);
        foreach (var path in files)
        {
            var bytes = File.ReadAllBytes(path);
            var position = checked((int)BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(4)));
            var found = false;
            while (position < bytes.Length)
            {
                var length = checked((int)BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(position + 8)));
                Assert.InRange(length, 12, bytes.Length - position);
                if (bytes.AsSpan(position, 4).SequenceEqual("PPTH"u8))
                {
                    var size = checked((int)BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(position + 12)));
                    var contentPath = Encoding.BigEndianUnicode.GetString(bytes, position + 16, size - 2);
                    var expected = PioneerAnalysisPath.ForAudio(contentPath);
                    var actualBucket = Path.GetFileName(Path.GetDirectoryName(path));
                    var actualParent = Path.GetFileName(Path.GetDirectoryName(Path.GetDirectoryName(path)!));
                    Assert.Equal($"/PIONEER/USBANLZ/{actualParent}/{actualBucket}/ANLZ0000.DAT", expected);
                    found = true; break;
                }
                position += length;
            }
            Assert.True(found);
        }
    }

    private static PioneerExportTrack ExportTrack(string contentPath, int id) => new(id, contentPath, PioneerAnalysisPath.ForAudio(contentPath),
        new Track { Id = Guid.NewGuid(), FilePath = "unused.mp3", FileName = "unused.mp3", FileHash = "test" }, []);
}
