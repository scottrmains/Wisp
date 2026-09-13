using System.Security.Cryptography;
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using NAudio.Wave;
using Wisp.Core.Recordings;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Recordings;

public sealed record RecorderStatus(RecordingSession? Session, bool Busy, double Seconds,
    double SavedSeconds, float LeftPeak, float RightPeak, bool Clipped, double? RemainingSeconds, bool CloseRequested);

public sealed class MixRecorder(IServiceScopeFactory scopes, IRecordingInputDevices devices,
    CaptureLease captureLease, RecordingDiskStore disk, ILogger<MixRecorder> log) : IHostedService
{
    private readonly SemaphoreSlim operations = new(1, 1);
    private readonly object gate = new();
    private Task? job;
    private TaskCompletionSource? stop;
    private RecordingSession? current;
    private long acceptedBytes, savedBytes;
    private float left, right;
    private bool clipped, closeRequested, shuttingDown;
    private double? remaining;

    public RecorderStatus Status
    {
        get { lock (gate) return new(current, job is { IsCompleted: false },
            current == null ? 0 : (double)acceptedBytes / (current.SampleRate * 8),
            current == null ? 0 : (double)savedBytes / (current.SampleRate * 8), left, right, clipped, remaining, closeRequested); }
    }
    public bool RequestClose()
    {
        lock (gate)
        {
            if (job is not { IsCompleted: false }) { shuttingDown = true; return false; }
            closeRequested = true; return true;
        }
    }
    public void KeepRecording() { lock (gate) closeRequested = false; }
    public void PrepareClose()
    {
        lock (gate)
        {
            if (job is { IsCompleted: false } || current?.State == "Recoverable")
                throw new InvalidOperationException("Saving has not completed. Check the recording or recover it before closing.");
            shuttingDown = true; closeRequested = false;
        }
    }

    public async Task<RecordingSession> Start(Guid id, string title, string root, string endpointId, Guid? previousTakeId)
    {
        await operations.WaitAsync();
        IDisposable? lease = null;
        try
        {
            if (id == Guid.Empty || string.IsNullOrWhiteSpace(title) || title.Length > 200)
                throw new ArgumentException("Enter a recording title of up to 200 characters.");
            using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
            var existing = await db.RecordingSessions.FindAsync(id);
            if (existing != null)
            {
                if (existing.EndpointId != endpointId || existing.Title != title.Trim() || existing.PreviousTakeId != previousTakeId ||
                    !string.Equals(existing.DirectoryPath, Path.Combine(Path.GetFullPath(root), RecordingDiskStore.FolderName, id.ToString("D")), StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("This request ID belongs to another recording.");
                return existing;
            }
            lock (gate)
                if (shuttingDown || closeRequested || job is { IsCompleted: false })
                    throw new InvalidOperationException("Stop the current recording or finish the close dialog first.");
            if (previousTakeId != null && !await db.RecordingSessions.AnyAsync(r => r.Id == previousTakeId))
                throw new ArgumentException("The previous take could not be found.");
            var device = devices.List().FirstOrDefault(d => d.Id == endpointId && d.CanTest)
                ?? throw new InvalidOperationException("Choose an available stereo input. WISP will not switch inputs automatically.");
            lease = captureLease.Acquire();
            var directory = disk.NewDirectory(root, id);
            var session = new RecordingSession { Id = id, Title = title.Trim(), DirectoryPath = directory,
                EndpointId = endpointId, DeviceName = device.Name, SampleRate = device.SampleRate,
                StartedAt = DateTime.UtcNow, PreviousTakeId = previousTakeId };
            db.RecordingSessions.Add(session); await db.SaveChangesAsync(); // Register recovery location before audio starts.
            disk.WriteManifest(directory, Checkpoint(session, 0, "Preparing", null));
            lock (gate)
            {
                if (shuttingDown) throw new InvalidOperationException("WISP is closing; no capture was started.");
                current = session; acceptedBytes = savedBytes = 0; left = right = 0; clipped = false; remaining = null;
                stop = new(TaskCreationOptions.RunContinuationsAsynchronously);
                var ownedLease = lease; lease = null;
                job = Task.Run(() => Capture(session, stop.Task, ownedLease));
            }
            return session;
        }
        finally { lease?.Dispose(); operations.Release(); }
    }

    public void Stop(Guid id)
    {
        lock (gate)
        {
            if (current?.Id != id) throw new InvalidOperationException("Refresh status before stopping this recording.");
            stop?.TrySetResult();
        }
    }

    public async Task<T> WhenIdle<T>(Func<Task<T>> action)
    {
        await operations.WaitAsync();
        try
        {
            if (Status.Busy) throw new InvalidOperationException("Stop recording before managing saved takes.");
            return await action();
        }
        finally { operations.Release(); }
    }

    private async Task Capture(RecordingSession session, Task requestedStop, IDisposable lease)
    {
        IWaveIn? input = null;
        Task? nativeStop = null;
        try
        {
            string? issue = null;
            var interrupted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            void Interrupt(string message) { Interlocked.CompareExchange(ref issue, message, null); interrupted.TrySetResult(); }
            // At most 8 half-second packets = 4 seconds queued, independent of mix length.
            var queue = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(8) { SingleReader = true, SingleWriter = true });
            using var watchCancellation = new CancellationTokenSource();
            Task? writer = null;
            Stream? output = null;
            try
            {
                output = disk.CreateAudio(session.DirectoryPath);
                output.Write(RecordingDiskStore.Header(session.SampleRate, 0));
                disk.Checkpoint(session.DirectoryPath, output, Checkpoint(session, 0, "Recording", null));
                input = devices.Open(session.EndpointId);
                if (input.WaveFormat.Encoding != WaveFormatEncoding.IeeeFloat || input.WaveFormat.BitsPerSample != 32 ||
                    input.WaveFormat.Channels != 2 || input.WaveFormat.SampleRate != session.SampleRate)
                    throw new InvalidOperationException("The input format changed. Refresh devices before recording another take.");
                var stopped = new TaskCompletionSource<Exception?>(TaskCreationOptions.RunContinuationsAsynchronously);
                long lastPacket = Environment.TickCount64;
                input.DataAvailable += (_, args) =>
                {
                    if (interrupted.Task.IsCompleted) return;
                    var now = Environment.TickCount64;
                    if (now - Interlocked.Exchange(ref lastPacket, now) > 3000)
                    { Interrupt("Audio delivery paused or the computer slept. This take was stopped; start a new linked take."); return; }
                    if (args.BytesRecorded == 0) return;
                    if (args.BytesRecorded % 8 != 0 || args.BytesRecorded > session.SampleRate * 4)
                    { Interrupt("The audio driver delivered an oversized or incomplete packet. This take was stopped."); return; }
                    var bytes = args.Buffer.AsSpan(0, args.BytesRecorded).ToArray();
                    if (!queue.Writer.TryWrite(bytes))
                    { Interrupt("The recording disk could not keep up. Audio was not silently dropped; this take was stopped."); return; }
                    var peaks = RecordingInputTest.Peaks(bytes);
                    lock (gate) { acceptedBytes += bytes.Length; left = peaks.Left; right = peaks.Right; clipped |= left >= 1 || right >= 1; }
                };
                input.RecordingStopped += (_, args) => stopped.TrySetResult(args.Exception);
                writer = WritePackets(session, output, queue.Reader, () => issue);
                lock (gate) session.State = "Recording";
                input.StartRecording();
                var watchdog = Task.Run(async () =>
                {
                    try
                    {
                        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
                        while (await timer.WaitForNextTickAsync(watchCancellation.Token))
                            if (Environment.TickCount64 - Interlocked.Read(ref lastPacket) > 3000)
                                Interrupt("No audio arrived for three seconds. Check the input or wake the computer, then start a new take.");
                    }
                    catch (OperationCanceledException) { }
                });
                var ended = await Task.WhenAny(requestedStop, stopped.Task, interrupted.Task, writer);
                if (ended == stopped.Task && !requestedStop.IsCompleted)
                    Interrupt("The recording device stopped or disconnected. This take may be incomplete.");
                if (writer.IsFaulted) Interrupt("Writing the recording failed. Recover the last checkpoint after checking the disk.");
                lock (gate) { session.State = "Finalising"; left = right = 0; }
                try
                {
                    nativeStop = Task.Run(input.StopRecording);
                    await nativeStop.WaitAsync(TimeSpan.FromSeconds(5));
                    var error = await stopped.Task.WaitAsync(TimeSpan.FromSeconds(5));
                    if (error != null) Interrupt("The audio device reported an error. The saved take may be incomplete.");
                }
                finally { queue.Writer.TryComplete(); watchCancellation.Cancel(); }
                await watchdog; await writer;
                if (session.AudioBytes == 0) throw new IOException("No audio was captured. Check the selected input before trying again.");
                disk.Checkpoint(session.DirectoryPath, output, Checkpoint(session, session.AudioBytes, "Finalising", issue));
                output.Dispose();
                var path = disk.Promote(session.DirectoryPath);
                RecordingDiskStore.Validate(path, session.SampleRate, session.AudioBytes);
                session.AudioHash = await Hash(path);
                session.State = "Ready"; session.Issue = issue;
                disk.WriteManifest(session.DirectoryPath, Checkpoint(session, session.AudioBytes, "Ready", issue));
                await Persist(session);
            }
            catch (Exception ex)
            {
                watchCancellation.Cancel(); queue.Writer.TryComplete();
                // Reader may still be unwinding an I/O failure. Never discard its exception.
                if (writer != null) { try { await writer; } catch (Exception writeError) { log.LogWarning(writeError, "Recording writer stopped"); } }
                log.LogWarning(ex, "Recording {RecordingId} interrupted", session.Id);
                var state = "Recoverable";
                try { if (disk.Read(session.DirectoryPath, session.Id, session.SampleRate).AudioBytes == 0) state = "Failed"; }
                catch (Exception readError) { log.LogWarning(readError, "Checkpoint unavailable; retaining session for recovery"); }
                lock (gate) { session.State = state; session.Issue = issue ?? "Recording interrupted. Check the disk/input, then recover the saved checkpoint. " + SafeMessage(ex); left = right = 0; }
                try { await Persist(session); } catch (Exception saveError) { log.LogError(saveError, "Recording data retained; database status could not be updated"); }
            }
            finally { output?.Dispose(); }
        }
        finally
        {
            // Some device drivers can hang inside Dispose/Join after unplugging.
            // Keep the UI responsive and retain the input lease until it actually
            // stops, rather than opening a second capture over an unknown state.
            var released = input == null;
            if (input != null)
            {
                var disposing = Task.Run(async () =>
                {
                    // Do not race disposal against a native StopRecording call
                    // that is still stuck inside its driver.
                    if (nativeStop != null) { try { await nativeStop; } catch { /* Dispose still gets its turn. */ } }
                    input.Dispose();
                });
                try { await disposing.WaitAsync(TimeSpan.FromSeconds(5)); released = true; }
                catch (Exception ex)
                {
                    log.LogWarning(ex, "Audio driver has not released recording input");
                    lock (gate) session.Issue = (session.Issue ?? "") + " The audio driver could not release the input. Restart WISP before recording again; saved files were retained.";
                    try { await Persist(session); } catch (Exception saveError) { log.LogWarning(saveError, "Could not persist driver warning"); }
                    if (!disposing.IsCompleted)
                        _ = disposing.ContinueWith(task => { _ = task.Exception; if (task.IsCompletedSuccessfully) lease.Dispose(); }, TaskScheduler.Default);
                }
            }
            if (released) lease.Dispose();
        }
    }

    private async Task WritePackets(RecordingSession session, Stream output, ChannelReader<byte[]> reader, Func<string?> issue)
    {
        long bytes = 0, checkpointBytes = 0;
        await foreach (var packet in reader.ReadAllAsync())
        {
            output.Write(packet); bytes += packet.Length;
            if (bytes - checkpointBytes >= session.SampleRate * 8L)
            {
                disk.Checkpoint(session.DirectoryPath, output, Checkpoint(session, bytes, "Recording", issue()));
                checkpointBytes = bytes;
                var available = disk.FreeBytes(session.DirectoryPath);
                lock (gate) { savedBytes = bytes; session.AudioBytes = bytes; remaining = Math.Max(0, (available - RecordingDiskStore.ReserveBytes) / (session.SampleRate * 8d)); }
                if (available < RecordingDiskStore.ReserveBytes) throw new IOException("Recording stopped before the disk filled. Free space before recovery.");
            }
        }
        disk.Checkpoint(session.DirectoryPath, output, Checkpoint(session, bytes, "Finalising", issue()));
        lock (gate) { session.AudioBytes = savedBytes = bytes; }
    }

    public async Task Recover(Guid id)
    {
        await operations.WaitAsync();
        try
        {
            if (Status.Busy) throw new InvalidOperationException("Stop recording before recovering a previous take.");
            using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
            var session = await db.RecordingSessions.FindAsync(id) ?? throw new ArgumentException("Recording not found.");
            if (session.State == "Deleted") throw new InvalidOperationException("This recording was deleted.");
            var checkpoint = disk.Recover(session.DirectoryPath, id, session.SampleRate);
            session.AudioBytes = checkpoint.AudioBytes; session.State = "Ready"; session.Issue = checkpoint.Issue;
            session.AudioHash = await Hash(Path.Combine(session.DirectoryPath, "master.wav"));
            await db.SaveChangesAsync();
            lock (gate)
            {
                current = session; acceptedBytes = savedBytes = checkpoint.AudioBytes;
                left = right = 0; clipped = false; remaining = null;
            }
        }
        finally { operations.Release(); }
    }

    private async Task Persist(RecordingSession session)
    {
        using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        db.Update(session); await db.SaveChangesAsync();
    }
    private static RecordingCheckpoint Checkpoint(RecordingSession s, long bytes, string state, string? issue) => new(1, s.Id, s.SampleRate, bytes, state, issue, DateTime.UtcNow);
    public static async Task<string> Hash(string path)
    {
        await using var file = File.OpenRead(path); return Convert.ToHexString(await SHA256.HashDataAsync(file));
    }
    public static string SafeMessage(Exception ex) => ex is IOException or InvalidOperationException ? ex.Message :
        "Check folder permissions, free space and Windows audio privacy settings. Original session files were kept.";

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        await db.RecordingSessions.Where(r => r.State == "Preparing" || r.State == "Recording" || r.State == "Finalising")
            .ExecuteUpdateAsync(p => p.SetProperty(r => r.State, "Recoverable").SetProperty(r => r.Issue, "WISP closed before this take finished. Recover its last checkpoint."), cancellationToken);
    }
    public async Task StopAsync(CancellationToken cancellationToken)
    {
        Task? task; lock (gate) { shuttingDown = true; stop?.TrySetResult(); task = job; }
        if (task != null) await task.WaitAsync(cancellationToken);
    }
}
