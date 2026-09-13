using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Wisp.Core.Recordings;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Recordings;

public sealed record WorkspaceJob(Guid Id, Guid RecordingId, string Kind, string State, double Progress, string? Error = null);
public sealed record RecordingMarker(Guid Id, double Seconds, string Label);

public sealed class RecordingWorkspace(IServiceScopeFactory scopes, CaptureLease lease,
    RecordingDiskStore disk, Mp3Transcoder transcoder, string cacheRoot, ILogger<RecordingWorkspace> log) : IHostedService
{
    private readonly object gate = new();
    private Task? running;
    private CancellationTokenSource? cancellation;
    private WorkspaceJob? job;
    private bool closing;
    public WorkspaceJob? Status { get { lock (gate) return job; } }
    public static string AudioPath(RecordingSession s) => s.RelinkedPath ?? Path.Combine(s.DirectoryPath, "master.wav");
    private string Cache(Guid id) => Path.Combine(cacheRoot, $"{id:D}.json");
    public async Task<RecordingSession> Require(Guid id)
    {
        using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        return await db.RecordingSessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id && !s.Hidden && s.State != "Deleted")
            ?? throw new ArgumentException("Recording not found. Refresh the mix list.");
    }
    public async Task<RecordingPeakData?> Peaks(Guid id)
    {
        var s = await Require(id);
        if (s.State != "Ready" || !File.Exists(AudioPath(s))) return null;
        RecordingDiskStore.RejectLinks(cacheRoot);
        var path = Cache(id);
        if (!File.Exists(path)) return null;
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException("Invalid waveform cache path.");
        try
        {
            if (new FileInfo(path).Length > 32 * 1024 * 1024) return null;
            await using var file = File.OpenRead(path);
            var cached = await JsonSerializer.DeserializeAsync<RecordingPeakData>(file);
            var source = new FileInfo(AudioPath(s));
            return cached?.Version == 1 && cached.Hash == s.AudioHash && cached.LastWriteTicks == source.LastWriteTimeUtc.Ticks && cached.FileBytes == source.Length ? cached : null;
        }
        catch (JsonException) { return null; }
    }
    public WorkspaceJob StartPeaks(Guid id) => Start(id, "waveform", async ct =>
    {
        var s = await Require(id);
        if (s.State != "Ready" || s.AudioHash == null) throw new InvalidOperationException("Finish saving or recover this recording first.");
        var data = await RecordingPeaks.Generate(AudioPath(s), s.SampleRate, s.AudioBytes, s.AudioHash, Report, ct);
        RecordingDiskStore.RejectLinks(cacheRoot); Directory.CreateDirectory(cacheRoot);
        var temporary = Path.Combine(cacheRoot, Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            await using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            { await JsonSerializer.SerializeAsync(file, data, cancellationToken: ct); file.Flush(true); }
            ct.ThrowIfCancellationRequested();
            if (File.Exists(Cache(id)) && (File.GetAttributes(Cache(id)) & FileAttributes.ReparsePoint) != 0) throw new IOException("Invalid waveform cache path.");
            File.Move(temporary, Cache(id), true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    });
    private WorkspaceJob Start(Guid id, string kind, Func<CancellationToken, Task> work)
    {
        lock (gate)
        {
            if (closing) throw new InvalidOperationException("WISP is closing.");
            if (running is { IsCompleted: false })
            {
                if (job!.RecordingId == id && job.Kind == kind) return job;
                throw new InvalidOperationException("Finish or cancel the current import/waveform job first.");
            }
            cancellation?.Dispose(); cancellation = new(); var token = cancellation.Token;
            job = new(Guid.NewGuid(), id, kind, "Running", 0);
            running = Task.Run(async () =>
            {
                try { await work(token); lock (gate) job = job! with { State = "Ready", Progress = 1 }; }
                catch (OperationCanceledException) { lock (gate) job = job! with { State = "Cancelled" }; }
                catch (Exception ex) { log.LogWarning(ex, "Recording workspace job failed"); lock (gate) job = job! with { State = "Failed", Error = ex is IOException or ArgumentException or InvalidOperationException ? ex.Message : "Could not process the mix. Check the file, free space and FFmpeg settings." }; }
            });
            return job;
        }
    }
    private void Report(double progress) { lock (gate) job = job! with { Progress = Math.Clamp(progress, 0, .99) }; }
    public void Cancel(Guid id) { lock (gate) { if (job?.Id != id) throw new ArgumentException("This job is no longer current."); cancellation?.Cancel(); } }

    public WorkspaceJob Import(Guid id, string source, string folder) => Start(id, "import", async ct =>
    {
        if (id == Guid.Empty || !Path.IsPathFullyQualified(source)) throw new ArgumentException("Choose a local audio file.");
        var extension = Path.GetExtension(source).ToLowerInvariant();
        if (!new[] { ".wav", ".mp3", ".flac", ".aiff", ".aif" }.Contains(extension)) throw new ArgumentException("Import WAV, MP3, FLAC or AIFF mixes.");
        var ffmpeg = transcoder.FfmpegPath ?? throw new InvalidOperationException("FFmpeg is unavailable. Check its path in Settings.");
        using var captureLease = lease.Acquire(); // Import I/O cannot compete with capture.
        using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        if (await db.RecordingSessions.AnyAsync(s => s.Id == id, ct)) throw new InvalidOperationException("This import already has a session. Select it in the list or start a new import.");
        await using var original = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, true);
        if (original.Length == 0) throw new IOException("The selected file is empty.");
        var hash = Convert.ToHexString(await SHA256.HashDataAsync(original, ct)); original.Position = 0;
        if (await db.RecordingSessions.AnyAsync(s => s.AudioHash == hash && !s.Hidden && s.State == "Ready", ct) ||
            await db.RecordingReviews.Join(db.RecordingSessions, r => r.Id, s => s.Id, (r, s) => new { r.SourceHash, s.Hidden, s.State })
            .AnyAsync(r => r.SourceHash == hash && !r.Hidden && r.State == "Ready", ct))
            throw new InvalidOperationException("This exact file is already in your mixes. Nothing was copied.");
        var directory = disk.NewDirectory(folder, id);
        var s = new RecordingSession { Id = id, Title = Path.GetFileNameWithoutExtension(source)[..Math.Min(200, Path.GetFileNameWithoutExtension(source).Length)],
            DirectoryPath = directory, DeviceName = "Imported mix", EndpointId = "import", SampleRate = 44100, StartedAt = DateTime.UtcNow, State = "Importing" };
        db.RecordingSessions.Add(s); db.RecordingReviews.Add(new() { Id = id, SourceHash = hash }); await db.SaveChangesAsync(ct);
        try
        {
            // Retain an exact managed source copy; the user's source is read-only.
            var copy = Path.Combine(directory, "original" + extension);
            await using (var target = new FileStream(copy, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, true))
            {
                var buffer = new byte[65536]; int read; long copied = 0;
                while ((read = await original.ReadAsync(buffer, ct)) > 0)
                {
                    if (disk.FreeBytes(directory) < RecordingDiskStore.ReserveBytes + read) throw new IOException("Not enough free space to import this mix.");
                    await target.WriteAsync(buffer.AsMemory(0, read), ct); copied += read; Report(.2 * copied / original.Length);
                }
                target.Flush(true);
            }
            using var output = disk.CreateAudio(directory); output.Write(RecordingDiskStore.Header(44100, 0));
            var start = new ProcessStartInfo(ffmpeg) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var arg in new[] { "-v", "error", "-nostdin", "-xerror", "-i", copy, "-map", "0:a:0", "-vn", "-ac", "2", "-ar", "44100", "-f", "f32le", "pipe:1" }) start.ArgumentList.Add(arg);
            using var process = Process.Start(start) ?? throw new IOException("Could not start FFmpeg.");
            using var kill = ct.Register(() => { try { if (!process.HasExited) process.Kill(true); } catch (InvalidOperationException) { } });
            // Drain stderr continuously, retaining only a bounded diagnostic tail.
            var errors = Task.Run(async () => { var b = new char[2048]; string tail = ""; int n; while ((n = await process.StandardError.ReadAsync(b)) > 0) { tail += new string(b, 0, n); if (tail.Length > 4096) tail = tail[^4096..]; } return tail; });
            long bytes = 0;
            try
            {
                var buffer = new byte[65536]; int n;
                while ((n = await process.StandardOutput.BaseStream.ReadAsync(buffer, ct)) > 0)
                {
                    if (disk.FreeBytes(directory) < RecordingDiskStore.ReserveBytes + n) throw new IOException("Not enough free space for the decoded playback master.");
                    output.Write(buffer, 0, n); bytes += n;
                    Report(.2 + .7 * bytes / (bytes + original.Length * 4d));
                }
                await process.WaitForExitAsync(ct); ct.ThrowIfCancellationRequested(); var error = await errors;
                if (process.ExitCode != 0 || bytes == 0 || bytes % 8 != 0) throw new IOException("The mix could not be decoded completely. Source files were retained. " + error);
            }
            finally { if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(); } await errors; }
            disk.Checkpoint(directory, output, new(1, id, 44100, bytes, "Finalising", null, DateTime.UtcNow)); output.Dispose();
            var master = disk.Promote(directory); s.AudioBytes = bytes; s.AudioHash = await MixRecorder.Hash(master);
            s.State = "Ready"; disk.WriteManifest(directory, new(1, id, 44100, bytes, "Ready", null, DateTime.UtcNow)); await db.SaveChangesAsync(CancellationToken.None);
        }
        catch
        {
            s.State = "Failed"; s.Issue = "Import did not finish. Original source and any managed partial files were retained. Start a new import to retry.";
            await db.SaveChangesAsync(CancellationToken.None); throw;
        }
    });
    public async Task StartAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        await db.RecordingSessions.Where(s => s.State == "Importing").ExecuteUpdateAsync(p => p.SetProperty(s => s.State, "Failed")
            .SetProperty(s => s.Issue, "Import interrupted by shutdown. Source files were retained; start a new import."), ct);
    }
    public async Task StopAsync(CancellationToken ct)
    {
        Task? task; lock (gate) { closing = true; cancellation?.Cancel(); task = running; }
        if (task != null) await task.WaitAsync(ct);
    }
}
