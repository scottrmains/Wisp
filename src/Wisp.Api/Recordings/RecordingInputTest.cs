using System.Buffers.Binary;
using System.Text.Json;
using NAudio.Wave;
using Wisp.Infrastructure.Audio;

namespace Wisp.Api.Recordings;

public sealed record InputTestResult(Guid? Id, string State, string? DeviceName = null,
    string? EndpointId = null, string? MixFormat = null, int SampleRate = 0,
    double Seconds = 0, float LeftPeak = 0, float RightPeak = 0,
    bool LeftClipped = false, bool RightClipped = false, bool HasAudio = false,
    string? Message = null, string? AudioPath = null, string? WindowsVersion = null,
    string? Assessment = null);

/// Deliberately bounded diagnostic, NOT the durable Phase 26b mix recorder.
/// One clip per run, <=30 seconds / 46 MB at 192 kHz; no monitoring or DB access.
public sealed class RecordingInputTest : IHostedService
{
    public const int MaximumSeconds = 30;
    private readonly object gate = new();
    private readonly IRecordingInputDevices devices;
    private readonly ILogger<RecordingInputTest> log;
    private readonly string folder;
    private Task? running;
    private TaskCompletionSource? stop;
    private InputTestResult result = new(null, "Idle");
    private bool shuttingDown;
    private readonly CaptureLease captureLease;

    public RecordingInputTest(IRecordingInputDevices devices, ILogger<RecordingInputTest> log, string folder, CaptureLease? captureLease = null)
    {
        this.devices = devices;
        this.log = log;
        this.folder = Path.GetFullPath(folder);
        this.captureLease = captureLease ?? new CaptureLease();
        try
        {
            if (File.Exists(ReportPath))
                result = JsonSerializer.Deserialize<InputTestResult>(File.ReadAllText(ReportPath)) ?? result;
            // Never expose a persisted arbitrary file path to the audio endpoint.
            result = result with { AudioPath = result.Id is { } id ? ClipPath(id) : null };
            if (result.HasAudio && (result.AudioPath == null || !File.Exists(result.AudioPath)))
                result = result with { State = "Failed", HasAudio = false,
                    Message = "The previous test file is missing. Record a new short test." };
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            log.LogWarning(ex, "Could not load the previous recording input test report");
        }
    }

    private string ReportPath => Path.Combine(folder, "last-test.json");
    private string ClipPath(Guid id) => Path.Combine(folder, $"{id:D}.wav");
    public InputTestResult Status { get { lock (gate) return result; } }

    public InputTestResult Start(Guid requestId, RecordingInputDevice device, Action? persistSelection = null)
    {
        lock (gate)
        {
            if (shuttingDown) throw new InvalidOperationException("WISP is closing. Reopen it to test an input.");
            if (requestId == Guid.Empty) throw new ArgumentException("A test request ID is required.");
            if (result.Id == requestId)
            {
                if (result.EndpointId != device.Id) throw new InvalidOperationException("This test request belongs to another input. Refresh and try again.");
                return result; // Safe retry of a timed-out POST.
            }
            if (running is { IsCompleted: false })
                throw new InvalidOperationException("An input test is already running. Stop it before starting another.");
            if (!device.CanTest) throw new InvalidOperationException(device.UnavailableReason);
            var lease = this.captureLease.Acquire();
            try
            {
                persistSelection?.Invoke(); // Reject conflicts before changing saved settings.
                result = new(requestId, "Preparing", device.Name, device.Id, device.MixFormat,
                    device.SampleRate, WindowsVersion: Environment.OSVersion.VersionString);
                stop = new(TaskCreationOptions.RunContinuationsAsynchronously);
                running = Task.Run(async () => { using (lease) await RunAsync(requestId, device, stop.Task); });
                return result;
            }
            catch { lease.Dispose(); throw; }
        }
    }

    public InputTestResult Stop(Guid id)
    {
        lock (gate)
        {
            if (result.Id != id) throw new InvalidOperationException("That input test is no longer current. Refresh its status.");
            stop?.TrySetResult();
            return result;
        }
    }

    public void Assess(Guid id, string assessment)
    {
        lock (gate)
        {
            if (result.Id != id || result.State != "Ready")
                throw new InvalidOperationException("Listen to a completed test before saving routing evidence.");
            if (string.IsNullOrWhiteSpace(assessment) || assessment.Length > 4000)
                throw new ArgumentException("Enter up to 4,000 characters of test observations.");
            var next = result with { Assessment = assessment.Trim() };
            SaveReport(next);
            result = next;
        }
    }

    public string? AudioPath(Guid id)
    {
        lock (gate)
            return result.Id == id && result.HasAudio && File.Exists(ClipPath(id)) ? ClipPath(id) : null;
    }

    private async Task RunAsync(Guid id, RecordingInputDevice device, Task requestedStop)
    {
        string? failure = null;
        var ownsTemporaryFile = false;
        using var data = new MemoryStream();
        try
        {
            Directory.CreateDirectory(folder);
            // Verify destination access before opening any audio device.
            using (new FileStream(ClipPath(id) + ".tmp", FileMode.CreateNew, FileAccess.Write)) { }
            ownsTemporaryFile = true;
            using var capture = devices.Open(device.Id);
            var format = capture.WaveFormat;
            if (format.Channels != 2 || format.Encoding != WaveFormatEncoding.IeeeFloat ||
                format.BitsPerSample != 32 || format.SampleRate != device.SampleRate)
                throw new InvalidOperationException("The driver did not provide the requested stereo float format. Refresh devices and check Windows Sound settings.");
            var maximumBytes = checked(format.AverageBytesPerSecond * MaximumSeconds);
            data.Capacity = maximumBytes;
            var stopped = new TaskCompletionSource<Exception?>(TaskCreationOptions.RunContinuationsAsynchronously);
            var full = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            capture.DataAvailable += (_, args) =>
            {
                lock (gate)
                {
                    var count = Math.Min(args.BytesRecorded, maximumBytes - (int)data.Length);
                    count -= count % 8;
                    data.Write(args.Buffer, 0, count);
                    var (left, right) = Peaks(args.Buffer.AsSpan(0, count));
                    result = result with { Seconds = (double)data.Length / format.AverageBytesPerSecond,
                        LeftPeak = left, RightPeak = right,
                        LeftClipped = result.LeftClipped || left >= 1,
                        RightClipped = result.RightClipped || right >= 1 };
                    if (data.Length >= maximumBytes) full.TrySetResult();
                }
            };
            capture.RecordingStopped += (_, args) => stopped.TrySetResult(args.Exception);
            lock (gate) result = result with { State = "Recording" };
            capture.StartRecording();
            var ended = await Task.WhenAny(requestedStop, full.Task, Task.Delay(TimeSpan.FromSeconds(MaximumSeconds)), stopped.Task);
            lock (gate) result = result with { State = "Finalising", LeftPeak = 0, RightPeak = 0 };
            capture.StopRecording();
            var error = await stopped.Task.WaitAsync(TimeSpan.FromSeconds(5));
            if (error != null) failure = FriendlyError(error);
            else if (ended == stopped.Task && !requestedStop.IsCompleted && !full.Task.IsCompleted)
                failure = "The input stopped unexpectedly. This clip may be incomplete. Reconnect the input and repeat the test.";
            if (data.Length == 0)
                throw new InvalidOperationException("No audio frames arrived. Check the input, Windows permissions and whether another app holds the device exclusively.");
            using (var writer = new WaveFileWriter(ClipPath(id) + ".tmp", format))
                writer.Write(data.GetBuffer(), 0, (int)data.Length);
            File.Move(ClipPath(id) + ".tmp", ClipPath(id));
            lock (gate)
            {
                result = result with { State = failure == null ? "Ready" : "Failed", HasAudio = true,
                    Message = failure, AudioPath = ClipPath(id) };
                SaveReport(result);
            }
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Recording input test {TestId} failed", id);
            lock (gate) result = result with { State = "Failed", Message = FriendlyError(ex), LeftPeak = 0, RightPeak = 0 };
        }
        finally
        {
            try { if (ownsTemporaryFile) File.Delete(ClipPath(id) + ".tmp"); }
            catch (Exception ex) { log.LogWarning(ex, "Could not clean input-test temporary file"); }
        }
    }

    public static (float Left, float Right) Peaks(ReadOnlySpan<byte> samples)
    {
        float left = 0, right = 0;
        for (var i = 0; i + 7 < samples.Length; i += 8)
        {
            var l = BinaryPrimitives.ReadSingleLittleEndian(samples[i..]);
            var r = BinaryPrimitives.ReadSingleLittleEndian(samples[(i + 4)..]);
            // Invalid driver samples are shown as clipping, never JSON NaN/Infinity.
            left = Math.Max(left, float.IsFinite(l) ? Math.Abs(l) : 1);
            right = Math.Max(right, float.IsFinite(r) ? Math.Abs(r) : 1);
        }
        return (Math.Min(left, 2), Math.Min(right, 2));
    }

    private void SaveReport(InputTestResult value)
    {
        Directory.CreateDirectory(folder);
        var json = JsonSerializer.Serialize(value, new JsonSerializerOptions { WriteIndented = true });
        // Retain evidence beside each clip even after another test becomes current.
        var evidencePath = Path.Combine(folder, $"{value.Id:D}.json");
        File.WriteAllText(evidencePath + ".tmp", json);
        File.Move(evidencePath + ".tmp", evidencePath, true);
        File.WriteAllText(ReportPath + ".tmp", json);
        File.Move(ReportPath + ".tmp", ReportPath, true);
    }

    private static string FriendlyError(Exception ex) => ex switch
    {
        InvalidOperationException => ex.Message,
        UnauthorizedAccessException => "Access denied. Allow desktop microphone access in Windows Privacy settings and check the test folder is writable.",
        IOException => "The input test could not be saved. Check free disk space and access to the test folder.",
        PlatformNotSupportedException => "Recording input tests require Windows.",
        TimeoutException => "The audio driver did not stop promptly. Reconnect the device and restart WISP before retrying.",
        _ => "Could not capture this input. Reconnect it, close apps using it exclusively, and check Windows Sound and microphone privacy settings. No other input was selected."
    };

    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    public async Task StopAsync(CancellationToken cancellationToken)
    {
        Task? task;
        lock (gate) { shuttingDown = true; stop?.TrySetResult(); task = running; }
        if (task != null) await task.WaitAsync(cancellationToken);
    }
}
