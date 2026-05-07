using System.Buffers;
using System.Security.Cryptography;

namespace Wisp.Infrastructure.FileSystem;

public interface IFileFingerprint
{
    Task<string> ComputeAsync(string path, CancellationToken cancellationToken = default);
}

/// SHA-256 over: first 1 MiB + last 1 MiB + size-as-bytes.
/// Cheap and stable across renames/moves; avoids hashing entire multi-MiB FLACs.
/// Files smaller than 2 MiB are hashed in full (the head/tail would overlap anyway).
public class FileFingerprint : IFileFingerprint
{
    private const int ChunkSize = 1 * 1024 * 1024;

    public async Task<string> ComputeAsync(string path, CancellationToken cancellationToken = default)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read,
            bufferSize: 64 * 1024, FileOptions.SequentialScan | FileOptions.Asynchronous);

        var length = fs.Length;
        using var sha = SHA256.Create();
        var buffer = ArrayPool<byte>.Shared.Rent(ChunkSize);

        try
        {
            if (length <= ChunkSize * 2)
            {
                var read = await ReadFullyAsync(fs, buffer.AsMemory(0, (int)length), cancellationToken);
                sha.TransformBlock(buffer, 0, read, null, 0);
            }
            else
            {
                var head = await ReadFullyAsync(fs, buffer.AsMemory(0, ChunkSize), cancellationToken);
                sha.TransformBlock(buffer, 0, head, null, 0);

                fs.Seek(-ChunkSize, SeekOrigin.End);
                var tail = await ReadFullyAsync(fs, buffer.AsMemory(0, ChunkSize), cancellationToken);
                sha.TransformBlock(buffer, 0, tail, null, 0);
            }

            var sizeBytes = BitConverter.GetBytes(length);
            sha.TransformFinalBlock(sizeBytes, 0, sizeBytes.Length);

            return Convert.ToHexString(sha.Hash!);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static async Task<int> ReadFullyAsync(Stream s, Memory<byte> dest, CancellationToken ct)
    {
        var total = 0;
        while (total < dest.Length)
        {
            var n = await s.ReadAsync(dest[total..], ct);
            if (n == 0) break;
            total += n;
        }
        return total;
    }
}
