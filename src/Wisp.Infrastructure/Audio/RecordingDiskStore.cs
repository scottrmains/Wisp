using System.Text;
using System.Text.Json;

namespace Wisp.Infrastructure.Audio;

public sealed record RecordingCheckpoint(int Version, Guid Id, int SampleRate, long AudioBytes,
    string State, string? Issue, DateTime UpdatedAt);

/// One append-only audio file plus an atomic, flushed checkpoint. No full-file copy
/// is needed to finalise/recover, even beyond 4 GiB. The reserved JUNK becomes ds64.
public class RecordingDiskStore
{
    public const string FolderName = "WISP Recordings";
    public const int HeaderBytes = 92;
    public const long ReserveBytes = 64L * 1024 * 1024;
    public virtual long FreeBytes(string folder) => new DriveInfo(Path.GetPathRoot(Path.GetFullPath(folder))!).AvailableFreeSpace;

    public string NewDirectory(string root, Guid id)
    {
        if (!Path.IsPathFullyQualified(root)) throw new ArgumentException("Choose an absolute recordings folder.");
        var parent = Path.Combine(Path.GetFullPath(root), FolderName);
        RejectLinks(parent);
        Directory.CreateDirectory(parent);
        // Do not start on FAT32, whose per-file ceiling defeats RF64.
        var drive = new DriveInfo(Path.GetPathRoot(parent)!);
        if (drive.IsReady && drive.DriveFormat.Equals("FAT32", StringComparison.OrdinalIgnoreCase))
            throw new IOException("Use an NTFS or exFAT recording destination; FAT32 cannot hold long masters.");
        if (FreeBytes(parent) < ReserveBytes * 2) throw new IOException("At least 128 MiB of free space is required to start recording.");
        var directory = Path.Combine(parent, id.ToString("D"));
        if (Directory.Exists(directory)) throw new IOException("This recording directory already exists. Choose a new take.");
        Directory.CreateDirectory(directory);
        using (var claim = new FileStream(Path.Combine(directory, "owner"), FileMode.CreateNew, FileAccess.Write, FileShare.None))
        { claim.Write(id.ToByteArray()); claim.Flush(true); }
        return directory;
    }

    public virtual Stream CreateAudio(string directory)
    {
        RejectLinks(directory);
        var file = new FileStream(Path.Combine(directory, "master.wav.partial"), FileMode.CreateNew,
            FileAccess.ReadWrite, FileShare.Read, 64 * 1024);
        return file;
    }

    public virtual void Flush(Stream stream)
    {
        if (stream is FileStream file) file.Flush(true); else stream.Flush();
    }

    public virtual void Checkpoint(string directory, Stream stream, RecordingCheckpoint value)
    {
        var end = stream.Position;
        stream.Position = 0; stream.Write(Header(value.SampleRate, value.AudioBytes)); stream.Position = end;
        Flush(stream); // Audio durable before its length is published in the manifest.
        WriteManifest(directory, value);
    }

    public virtual void WriteManifest(string directory, RecordingCheckpoint value)
    {
        RejectLinks(directory);
        var path = Path.Combine(directory, "session.json");
        using (var file = new FileStream(path + ".tmp", FileMode.Create, FileAccess.Write, FileShare.None))
        {
            JsonSerializer.Serialize(file, value); file.Flush(true);
        }
        File.Move(path + ".tmp", path, true);
    }

    public RecordingCheckpoint Read(string directory, Guid id, int sampleRate)
    {
        RejectLinks(directory);
        var value = JsonSerializer.Deserialize<RecordingCheckpoint>(File.ReadAllText(Path.Combine(directory, "session.json")))
            ?? throw new IOException("Recording checkpoint is missing or invalid.");
        if (value.Version != 1 || value.Id != id || value.SampleRate != sampleRate ||
            sampleRate is < 8000 or > 192000 || value.AudioBytes < 0 || value.AudioBytes % 8 != 0)
            throw new IOException("Recording checkpoint does not match this session. Original files have been retained.");
        return value;
    }

    public virtual string Promote(string directory)
    {
        RejectLinks(directory);
        var output = Path.Combine(directory, "master.wav");
        File.Move(Path.Combine(directory, "master.wav.partial"), output); // Never overwrite.
        return output;
    }

    public RecordingCheckpoint Recover(string directory, Guid id, int sampleRate)
    {
        var checkpoint = Read(directory, id, sampleRate);
        if (checkpoint.AudioBytes == 0) throw new IOException("No checkpointed audio is available to recover. Session files were kept.");
        var completed = Path.Combine(directory, "master.wav");
        var partial = Path.Combine(directory, "master.wav.partial");
        if (File.Exists(completed))
        {
            if (File.Exists(partial)) throw new IOException("Both a master and partial exist. Retaining both for inspection.");
            Validate(completed, sampleRate, checkpoint.AudioBytes);
        }
        else
        {
            using (var file = new FileStream(partial, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            {
                if (file.Length < HeaderBytes + checkpoint.AudioBytes)
                    throw new IOException("Audio is shorter than its durable checkpoint. Nothing was truncated or replaced.");
                // Trim only this owned session's uncommitted tail, never guessed bytes.
                file.SetLength(HeaderBytes + checkpoint.AudioBytes);
                file.Position = 0; file.Write(Header(sampleRate, checkpoint.AudioBytes)); file.Flush(true);
            }
            Promote(directory);
        }
        var recovered = checkpoint with { State = "Ready", Issue = checkpoint.Issue ?? "Recovered interrupted take; audio after the last checkpoint was not included.", UpdatedAt = DateTime.UtcNow };
        WriteManifest(directory, recovered);
        return recovered;
    }

    public static void Validate(string path, int sampleRate, long bytes)
    {
        using var file = File.OpenRead(path);
        var header = new byte[HeaderBytes]; file.ReadExactly(header);
        if (file.Length != HeaderBytes + bytes || !header.AsSpan().SequenceEqual(Header(sampleRate, bytes)))
            throw new IOException("This file does not match the recording's format and length.");
    }

    public static byte[] Header(int sampleRate, long audioBytes)
    {
        if (sampleRate is < 8000 or > 192000 || audioBytes < 0 || audioBytes % 8 != 0)
            throw new ArgumentOutOfRangeException(nameof(audioBytes));
        var riffSize = checked(audioBytes + HeaderBytes - 8);
        var rf64 = riffSize >= uint.MaxValue;
        using var buffer = new MemoryStream(HeaderBytes);
        using var writer = new BinaryWriter(buffer, Encoding.ASCII, true);
        void Tag(string tag) => writer.Write(Encoding.ASCII.GetBytes(tag));
        Tag(rf64 ? "RF64" : "RIFF"); writer.Write(rf64 ? uint.MaxValue : (uint)riffSize); Tag("WAVE");
        Tag(rf64 ? "ds64" : "JUNK"); writer.Write(28);
        writer.Write(rf64 ? riffSize : 0L); writer.Write(rf64 ? audioBytes : 0L);
        writer.Write(rf64 ? audioBytes / 8 : 0L); writer.Write(0);
        Tag("fmt "); writer.Write(16); writer.Write((ushort)3); writer.Write((ushort)2);
        writer.Write(sampleRate); writer.Write(sampleRate * 8); writer.Write((ushort)8); writer.Write((ushort)32);
        Tag("fact"); writer.Write(4); writer.Write(rf64 ? uint.MaxValue : (uint)(audioBytes / 8));
        Tag("data"); writer.Write(rf64 ? uint.MaxValue : (uint)audioBytes);
        return buffer.ToArray();
    }

    public static void RejectLinks(string path)
    {
        for (var current = new DirectoryInfo(Path.GetFullPath(path)); current != null; current = current.Parent)
            if (current.Exists && (current.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new IOException("Use a direct recording folder, not a symbolic link or junction.");
        foreach (var name in new[] { "master.wav", "master.wav.partial", "session.json", "session.json.tmp", "original.wav", "original.mp3", "original.flac", "original.aiff", "original.aif" })
        {
            var file = new FileInfo(Path.Combine(path, name));
            if (file.Exists && (file.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new IOException("Recording files must not be symbolic links.");
        }
    }
}
