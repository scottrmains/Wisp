using Wisp.Infrastructure.FileSystem;
using Xunit;

namespace Wisp.Infrastructure.Tests;

public class FileFingerprintTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "wisp-fingerprint-" + Guid.NewGuid().ToString("N"));
    private readonly FileFingerprint _fp = new();

    public FileFingerprintTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { /* best effort */ }
    }

    [Fact]
    public async Task Same_bytes_at_two_paths_produce_same_hash()
    {
        var a = Path.Combine(_dir, "a.bin");
        var b = Path.Combine(_dir, "b.bin");
        var bytes = new byte[64 * 1024];
        Random.Shared.NextBytes(bytes);
        await File.WriteAllBytesAsync(a, bytes);
        await File.WriteAllBytesAsync(b, bytes);

        var ha = await _fp.ComputeAsync(a);
        var hb = await _fp.ComputeAsync(b);

        Assert.Equal(ha, hb);
    }

    [Fact]
    public async Task Different_bytes_produce_different_hash()
    {
        var a = Path.Combine(_dir, "a.bin");
        var b = Path.Combine(_dir, "b.bin");
        await File.WriteAllBytesAsync(a, new byte[] { 1, 2, 3, 4, 5 });
        await File.WriteAllBytesAsync(b, new byte[] { 9, 8, 7, 6, 5 });

        Assert.NotEqual(await _fp.ComputeAsync(a), await _fp.ComputeAsync(b));
    }

    [Fact]
    public async Task Large_file_uses_head_tail_chunks()
    {
        // 5 MiB file: head and tail chunks differ => hash differs even though middle is identical.
        var head1 = new byte[1 * 1024 * 1024];
        var middle = new byte[3 * 1024 * 1024];
        var tail1 = new byte[1 * 1024 * 1024];
        var tail2 = new byte[1 * 1024 * 1024];
        Random.Shared.NextBytes(head1);
        Random.Shared.NextBytes(middle);
        Random.Shared.NextBytes(tail1);
        Random.Shared.NextBytes(tail2);

        var a = Path.Combine(_dir, "a.bin");
        var b = Path.Combine(_dir, "b.bin");
        await File.WriteAllBytesAsync(a, head1.Concat(middle).Concat(tail1).ToArray());
        await File.WriteAllBytesAsync(b, head1.Concat(middle).Concat(tail2).ToArray());

        Assert.NotEqual(await _fp.ComputeAsync(a), await _fp.ComputeAsync(b));
    }

    [Fact]
    public async Task Same_file_hashes_consistently_on_repeat()
    {
        var a = Path.Combine(_dir, "a.bin");
        await File.WriteAllBytesAsync(a, new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 });
        var first = await _fp.ComputeAsync(a);
        var second = await _fp.ComputeAsync(a);
        Assert.Equal(first, second);
    }
}
