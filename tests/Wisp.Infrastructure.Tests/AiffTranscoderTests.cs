using System.Buffers.Binary;
using Microsoft.Extensions.Logging.Abstractions;
using NAudio.Wave;
using Wisp.Infrastructure.Audio;

namespace Wisp.Infrastructure.Tests;

public sealed class AiffTranscoderTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wisp-aiff-" + Guid.NewGuid().ToString("N"));
    private readonly string _source;
    private readonly AiffTranscoder _transcoder;

    public AiffTranscoderTests()
    {
        Directory.CreateDirectory(_root);
        _source = Path.Combine(_root, "source.aiff");
        File.WriteAllBytes(_source, PcmAiff());
        _transcoder = new AiffTranscoder(NullLogger<AiffTranscoder>.Instance, cacheDirectory: Path.Combine(_root, "cache"));
    }

    [Fact]
    public async Task Normal_aiff_remains_playable_without_ffmpeg_and_source_is_unchanged()
    {
        var before = File.ReadAllBytes(_source);
        var output = await _transcoder.GetOrCreateAsync(_source, "hash", default);
        using var wav = new WaveFileReader(output);
        Assert.Equal(44100, wav.WaveFormat.SampleRate);
        Assert.Equal(16, wav.WaveFormat.BitsPerSample);
        Assert.Equal(2000, wav.Length);
        Assert.Equal(before, File.ReadAllBytes(_source));
        Assert.Equal(output, await _transcoder.GetOrCreateAsync(_source, "hash", default));
    }

    [Fact]
    public async Task Concurrent_waveform_and_player_requests_use_separate_temporary_files()
    {
        var paths = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => _transcoder.GetOrCreateAsync(_source, "same", default)));
        Assert.Single(paths.Distinct());
        using var wav = new WaveFileReader(paths[0]);
        Assert.Equal(2000, wav.Length);
        Assert.Empty(Directory.GetFiles(Path.Combine(_root, "cache"), "*.tmp"));
    }

    [Fact]
    public async Task Same_hash_with_changed_source_timestamp_gets_a_new_cache_file()
    {
        var first = await _transcoder.GetOrCreateAsync(_source, "same", default);
        File.SetLastWriteTimeUtc(_source, File.GetLastWriteTimeUtc(_source).AddMinutes(1));
        Assert.NotEqual(first, await _transcoder.GetOrCreateAsync(_source, "same", default));
    }

    [Fact]
    public async Task Cancellation_leaves_no_partial_cache()
    {
        using var ct = new CancellationTokenSource();
        ct.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => _transcoder.GetOrCreateAsync(_source, "cancel", ct.Token));
        Assert.Empty(Directory.GetFiles(Path.Combine(_root, "cache")));
    }

    private static byte[] PcmAiff()
    {
        var bytes = new byte[2054];
        "FORM"u8.CopyTo(bytes);
        BinaryPrimitives.WriteInt32BigEndian(bytes.AsSpan(4), bytes.Length - 8);
        "AIFFCOMM"u8.CopyTo(bytes.AsSpan(8));
        BinaryPrimitives.WriteInt32BigEndian(bytes.AsSpan(16), 18);
        BinaryPrimitives.WriteInt16BigEndian(bytes.AsSpan(20), 1);
        BinaryPrimitives.WriteInt32BigEndian(bytes.AsSpan(22), 1000);
        BinaryPrimitives.WriteInt16BigEndian(bytes.AsSpan(26), 16);
        new byte[] { 0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0 }.CopyTo(bytes, 28);
        "SSND"u8.CopyTo(bytes.AsSpan(38));
        BinaryPrimitives.WriteInt32BigEndian(bytes.AsSpan(42), 2008);
        return bytes;
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);
}
