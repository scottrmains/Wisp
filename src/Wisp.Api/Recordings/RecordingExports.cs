using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Wisp.Core.Recordings;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Recordings;

public sealed record MixExportRequest(Guid RequestId, string Folder, string Format, bool IncludeTracklist, int TracklistRevision);
public sealed record ExportProgress(Guid Id, Guid RecordingId, string State, double Progress, string? Error);

/// Durable request identities and immutable export packages; capture has priority.
public sealed class RecordingExports(IServiceScopeFactory scopes, RecordingWorkspace workspace, CaptureLease lease,
    RecordingDiskStore disk, MixExportEncoder encoder, ILogger<RecordingExports> log) : IHostedService
{
    private readonly SemaphoreSlim gate = new(1);
    private Task? running;
    private CancellationTokenSource? cancellation;
    private volatile ExportProgress? status;
    private bool closing;
    public ExportProgress? Status => status;
    private static readonly string[] OwnedNames = ["owner", "mix.mp3", "mix.wav", "tracklist.txt", "export.json"];
    public async Task<RecordingExport> Start(Guid recordingId, MixExportRequest request)
    {
        await gate.WaitAsync();
        IDisposable? acquired = null;
        try
        {
            using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
            var json = JsonSerializer.Serialize(request);
            var previous = await db.RecordingExports.FindAsync(request.RequestId);
            if (previous != null)
            {
                if (previous.RecordingId != recordingId || previous.RequestJson != json) throw new InvalidOperationException("This export request was already used with different options. Start a new export.");
                return previous;
            }
            if (closing || running is { IsCompleted: false }) throw new InvalidOperationException("Finish or cancel the current export first.");
            if (request.RequestId == Guid.Empty || request.Format is not ("mp3" or "wav" or "master") || !Path.IsPathFullyQualified(request.Folder))
                throw new ArgumentException("Choose an absolute destination folder and MP3, WAV or original master.");
            var session = await workspace.Require(recordingId);
            if (session.State != "Ready" || session.AudioBytes <= 0 || session.AudioHash == null)
                throw new InvalidOperationException("Finish saving or recover this recording before exporting.");
            if (!File.Exists(RecordingWorkspace.AudioPath(session))) throw new IOException("Master is missing. Reconnect its drive or relink the original master before exporting.");
            if (request.Format == "wav" && session.AudioBytes / 8 * 6 >= uint.MaxValue - 65536L)
                throw new ArgumentException("This mix exceeds standard WAV's 4 GiB limit. Choose MP3 for playback or Original master (RF64) for an exact copy.");
            var tracklist = await db.RecordingTracklists.FindAsync(recordingId);
            if (request.IncludeTracklist && (tracklist?.Revision ?? 0) != request.TracklistRevision)
                throw new InvalidOperationException("The actual tracklist changed. Refresh it before exporting.");
            var parent = Path.Combine(Path.GetFullPath(request.Folder), MixExportEncoder.FolderName);
            RecordingDiskStore.RejectLinks(parent); Directory.CreateDirectory(parent);
            var required = EstimateBytes(session, request.Format);
            var drive = new DriveInfo(Path.GetPathRoot(parent)!);
            if (drive.IsReady && drive.DriveFormat.Equals("FAT32", StringComparison.OrdinalIgnoreCase) && required >= uint.MaxValue)
                throw new IOException("This export is too large for FAT32. Choose an NTFS/exFAT destination or MP3.");
            if (disk.FreeBytes(parent) < required + RecordingDiskStore.ReserveBytes)
                throw new IOException("Not enough free space for the export plus a 64 MiB safety reserve. The existing master also stays on disk.");
            // A unique package is renamed on the same volume: no second full-size output copy.
            var title = string.Concat(session.Title.Where(c => !Path.GetInvalidFileNameChars().Contains(c) && !char.IsControl(c))).Trim().TrimEnd('.');
            if (title.Length > 60) title = title[..60];
            var row = new RecordingExport { Id = request.RequestId, RecordingId = recordingId, RequestJson = json, Title = session.Title,
                Format = request.Format, DirectoryPath = Path.Combine(parent, $"Mix {session.StartedAt:yyyy-MM-dd} {title} {request.RequestId:N}"),
                CreatedAt = DateTime.UtcNow, SourceHash = session.AudioHash,
                TracklistText = request.IncludeTracklist ? MixExportTracklist.Build(session.Title, session.StartedAt,
                    JsonSerializer.Deserialize<PerformedEntry[]>(tracklist?.EntriesJson ?? "[]")!, session.AudioBytes / (session.SampleRate * 8d)) : null };
            acquired = lease.Acquire();
            db.RecordingExports.Add(row); await db.SaveChangesAsync();
            cancellation?.Dispose(); cancellation = new(); var token = cancellation.Token;
            status = new(row.Id, recordingId, "Running", 0, null);
            var ownedLease = acquired; acquired = null;
            running = Task.Run(() => Work(row, session, ownedLease, token));
            return row;
        }
        finally { acquired?.Dispose(); gate.Release(); }
    }
    public static long EstimateBytes(RecordingSession s, string format) => checked(format switch
    {
        "mp3" => (long)Math.Ceiling(s.AudioBytes / (s.SampleRate * 8d) * 40000) + 4 * 1024 * 1024,
        "wav" => s.AudioBytes / 8 * 6 + 4 * 1024 * 1024,
        _ => s.AudioBytes + 4 * 1024 * 1024
    });
    private async Task Work(RecordingExport row, RecordingSession session, IDisposable acquired, CancellationToken ct)
    {
        var temporary = row.DirectoryPath + ".partial"; bool owned = false;
        using (acquired)
        {
            try
            {
                ct.ThrowIfCancellationRequested();
                var source = RecordingWorkspace.AudioPath(session);
                // Hold a read-only handle throughout: Windows cannot replace/delete the source mid-export.
                await using var sourceLock = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, true);
                RecordingDiskStore.Validate(source, session.SampleRate, session.AudioBytes);
                if (Convert.ToHexString(await SHA256.HashDataAsync(sourceLock, ct)) != row.SourceHash)
                    throw new IOException("The master changed since it was saved. No export was made; relink the original master.");
                RecordingDiskStore.RejectLinks(temporary);
                if (Directory.Exists(temporary) || Directory.Exists(row.DirectoryPath)) throw new IOException("This export folder already exists. Nothing was overwritten.");
                Directory.CreateDirectory(temporary);
                await using (var owner = new FileStream(Path.Combine(temporary, "owner"), FileMode.CreateNew, FileAccess.Write, FileShare.None))
                { owner.Write(row.Id.ToByteArray()); owner.Flush(true); }
                owned = true;
                var output = Path.Combine(temporary, MixExportEncoder.FileName(row.Format));
                void CheckSpace() { if (disk.FreeBytes(temporary) < RecordingDiskStore.ReserveBytes) throw new IOException("Export stopped because free space fell below the 64 MiB safety reserve."); }
                await encoder.Encode(source, output, row.Format, session.SampleRate, session.AudioBytes, row.Title, session.StartedAt,
                    p => status = new(row.Id, row.RecordingId, "Running", p, null), CheckSpace, ct);
                await using (var audio = new FileStream(output, FileMode.Open, FileAccess.ReadWrite, FileShare.None, 65536, true))
                { audio.Flush(true); row.OutputHash = Convert.ToHexString(await SHA256.HashDataAsync(audio, ct)); }
                if (row.Format == "master" && row.OutputHash != row.SourceHash) throw new IOException("Master copy hash did not match. No export was published.");
                row.OutputBytes = new FileInfo(output).Length; row.OutputWriteTicks = File.GetLastWriteTimeUtc(output).Ticks;
                if (row.TracklistText != null) await WriteNew(Path.Combine(temporary, "tracklist.txt"), row.TracklistText, ct);
                await WriteNew(Path.Combine(temporary, "export.json"), JsonSerializer.Serialize(new { version = 1, row.Id, row.RecordingId,
                    row.Title, recordedAt = session.StartedAt, row.Format, row.SourceHash, row.OutputHash, row.OutputBytes,
                    notice = "Audio and WISP's database both need backup to preserve review history. Comments/ratings are not embedded." }), ct);
                await workspace.Require(row.RecordingId); // Do not publish after removal from history.
                CheckSpace(); ct.ThrowIfCancellationRequested();
                RecordingDiskStore.RejectLinks(temporary); RecordingDiskStore.RejectLinks(row.DirectoryPath);
                Directory.Move(temporary, row.DirectoryPath); owned = false;
                row.State = "Ready";
            }
            catch (OperationCanceledException) { row.State = "Cancelled"; }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Mix export {Id} failed", row.Id); row.State = "Failed";
                row.Error = ex is IOException or ArgumentException or InvalidOperationException ? ex.Message : "Export could not finish. Check the drive, permissions and FFmpeg settings. The master is unchanged.";
            }
            finally
            {
                if (owned)
                    try { Cleanup(temporary, row.Id); }
                    catch (Exception ex) { log.LogWarning(ex, "Export partial retained"); row.Error = (row.Error ?? "Export stopped.") + " Some temporary files could not be removed; retained at " + temporary; }
            }
            try
            {
                using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
                db.RecordingExports.Update(row); await db.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Could not persist export completion"); row.State = "Failed";
                row.Error = "Export status could not be saved. Any completed package was retained at " + row.DirectoryPath + ". Restart WISP before retrying; the master is unchanged.";
            }
            status = new(row.Id, row.RecordingId, row.State, row.State == "Ready" ? 1 : status?.Progress ?? 0, row.Error);
        }
    }
    private static async Task WriteNew(string path, string text, CancellationToken ct)
    {
        await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        await file.WriteAsync(System.Text.Encoding.UTF8.GetBytes(text), ct); file.Flush(true);
    }
    private static void Cleanup(string directory, Guid id)
    {
        if (!Directory.Exists(directory)) return;
        if (!directory.EndsWith(id.ToString("N") + ".partial", StringComparison.Ordinal) || Path.GetFileName(Path.GetDirectoryName(directory)) != MixExportEncoder.FolderName)
            throw new IOException("Unrecognised temporary export path.");
        RecordingDiskStore.RejectLinks(directory);
        foreach (var path in Directory.EnumerateFileSystemEntries(directory))
            if (!OwnedNames.Contains(Path.GetFileName(path)) || (File.GetAttributes(path) & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0)
                throw new IOException("Unrecognised content in temporary export; retained for inspection.");
        if (!File.ReadAllBytes(Path.Combine(directory, "owner")).SequenceEqual(id.ToByteArray())) throw new IOException("Export ownership marker did not match.");
        foreach (var name in OwnedNames.Where(n => n != "owner")) File.Delete(Path.Combine(directory, name));
        File.Delete(Path.Combine(directory, "owner")); Directory.Delete(directory); // non-recursive, only our fixed files
    }
    public async Task Cancel(Guid id)
    {
        await gate.WaitAsync();
        try { if (status?.Id != id) throw new ArgumentException("This export is no longer active."); cancellation?.Cancel(); }
        finally { gate.Release(); }
    }
    public static bool Available(RecordingExport row)
    {
        if (row.State != "Ready") return false;
        try
        {
            RecordingDiskStore.RejectLinks(row.DirectoryPath);
            var file = new FileInfo(Path.Combine(row.DirectoryPath, MixExportEncoder.FileName(row.Format)));
            return file.Exists && (file.Attributes & FileAttributes.ReparsePoint) == 0 && file.Length == row.OutputBytes && file.LastWriteTimeUtc.Ticks == row.OutputWriteTicks;
        }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
    }
    public async Task StartAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        foreach (var row in await db.RecordingExports.Where(r => r.State == "Running").ToArrayAsync(ct))
        {
            row.State = "Interrupted"; row.Error = "Export interrupted by shutdown. Start a new export to retry. Completed packages, if any, remain at " + row.DirectoryPath;
            try { Cleanup(row.DirectoryPath + ".partial", row.Id); }
            catch (Exception ex) { log.LogWarning(ex, "Interrupted export partial retained"); row.Error += ". Temporary files could not be removed and were retained for inspection."; }
        }
        await db.SaveChangesAsync(ct);
    }
    public async Task StopAsync(CancellationToken ct)
    {
        Task? task; await gate.WaitAsync(ct);
        try { closing = true; cancellation?.Cancel(); task = running; } finally { gate.Release(); }
        if (task != null) await task.WaitAsync(ct);
    }
}
