using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NAudio.Wave;
using Wisp.Api.Recordings;
using Wisp.Api.Settings;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.FileSystem;

namespace Wisp.Api.Tests;

public sealed class RecordingInputTests : IAsyncLifetime
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "wisp-input-test-" + Guid.NewGuid().ToString("N"));
    private readonly Inputs inputs = new();
    private RecordingInputTest test = null!;
    private WebApplication app = null!;
    private WispSettingsStore settings = null!;
    private HttpClient Client => app.GetTestClient();

    public async Task InitializeAsync()
    {
        settings = new(Path.Combine(root, "settings.json"));
        test = new(inputs, NullLogger<RecordingInputTest>.Instance, Path.Combine(root, "clips"));
        var builder = WebApplication.CreateBuilder(); builder.WebHost.UseTestServer();
        builder.Services.AddSingleton<IRecordingInputDevices>(inputs);
        builder.Services.AddSingleton(settings); builder.Services.AddSingleton(test);
        app = builder.Build(); app.MapRecordingInputs(); await app.StartAsync();
    }

    private Task<HttpResponseMessage> Start(Guid id, string endpoint = "stereo-1") =>
        Client.PostAsJsonAsync("/api/recording-input/test", new { requestId = id, endpointId = endpoint });

    private async Task WaitFor(Func<bool> predicate)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (!predicate()) await Task.Delay(10, timeout.Token);
    }

    [Fact]
    public async Task No_default_or_automatic_capture_and_missing_endpoint_does_not_fallback()
    {
        var devices = await Client.GetStringAsync("/api/recording-input/devices");
        Assert.Contains("stereo-1", devices); Assert.Contains("\"selectedEndpointId\":null", devices);
        Assert.Equal(0, inputs.OpenCount);
        Assert.Equal(HttpStatusCode.Conflict, (await Start(Guid.NewGuid(), "missing")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Start(Guid.Empty)).StatusCode);
        Assert.Equal(0, inputs.OpenCount); Assert.Null(settings.Current.RecordingInputEndpointId);
    }

    [Fact]
    public async Task Explicit_endpoint_persists_and_clip_is_stereo_float_with_original_samples()
    {
        var id = Guid.NewGuid(); (await Start(id)).EnsureSuccessStatusCode();
        await WaitFor(() => inputs.Capture.Started);
        inputs.Capture.Emit([0.5f, -0.25f, -0.75f, 0.125f]);
        Assert.Equal(0.75f, test.Status.LeftPeak); Assert.Equal(0.25f, test.Status.RightPeak);
        (await Client.PostAsync($"/api/recording-input/test/{id}/stop", null)).EnsureSuccessStatusCode();
        await test.StopAsync(CancellationToken.None);
        Assert.Equal("Ready", test.Status.State); Assert.Equal("stereo-1", settings.Current.RecordingInputEndpointId);
        using var reader = new WaveFileReader(test.AudioPath(id)!);
        Assert.Equal(WaveFormatEncoding.IeeeFloat, reader.WaveFormat.Encoding);
        Assert.Equal(2, reader.WaveFormat.Channels); Assert.Equal(8000, reader.WaveFormat.SampleRate);
        Assert.Equal(new[] { 0.5f, -0.25f }, reader.ReadNextSampleFrame());
        Assert.Equal(2d / 8000, test.Status.Seconds);
        var audio = await Client.GetAsync($"/api/recording-input/test/{id}/audio");
        Assert.Equal("audio/wav", audio.Content.Headers.ContentType!.MediaType);
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/recording-input/test/{Guid.NewGuid()}/audio")).StatusCode);
        Assert.DoesNotContain(Directory.GetFiles(root, "*", SearchOption.AllDirectories), p => p.EndsWith(".db"));
    }

    [Fact]
    public async Task Repeated_start_is_idempotent_and_second_session_is_rejected()
    {
        var id = Guid.NewGuid(); (await Start(id)).EnsureSuccessStatusCode();
        (await Start(id)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await Start(Guid.NewGuid())).StatusCode);
        await WaitFor(() => inputs.Capture.Started);
        Assert.Equal(1, inputs.OpenCount);
        Assert.Equal(HttpStatusCode.Conflict, (await Client.PostAsync($"/api/recording-input/test/{Guid.NewGuid()}/stop", null)).StatusCode);
        Assert.Equal("Recording", test.Status.State);
    }

    [Fact]
    public async Task Thirty_second_frame_cap_auto_stops_and_clipping_is_latched()
    {
        (await Start(Guid.NewGuid())).EnsureSuccessStatusCode(); await WaitFor(() => inputs.Capture.Started);
        var samples = new float[8000 * 2 * 31]; samples[0] = 1; samples[1] = -1.2f;
        inputs.Capture.Emit(samples);
        await WaitFor(() => test.Status.HasAudio);
        Assert.Equal(30, test.Status.Seconds); Assert.True(test.Status.LeftClipped); Assert.True(test.Status.RightClipped);
        using var reader = new WaveFileReader(test.Status.AudioPath!);
        Assert.Equal(8000 * 8 * 30, reader.Length);
    }

    [Fact]
    public void Meter_handles_silence_channels_and_invalid_values_without_nonfinite_json()
    {
        Assert.Equal((0f, 0f), RecordingInputTest.Peaks([]));
        var bytes = new byte[16]; Buffer.BlockCopy(new[] { float.NaN, float.PositiveInfinity, -0.2f, 0.5f }, 0, bytes, 0, 16);
        Assert.Equal((1f, 1f), RecordingInputTest.Peaks(bytes));
    }

    [Fact]
    public async Task Device_loss_keeps_partial_audio_and_reports_failure_not_success()
    {
        (await Start(Guid.NewGuid())).EnsureSuccessStatusCode(); await WaitFor(() => inputs.Capture.Started);
        inputs.Capture.Emit([0.1f, 0.2f]); inputs.Capture.Fail(new System.Runtime.InteropServices.COMException());
        await WaitFor(() => test.Status.HasAudio);
        Assert.Equal("Failed", test.Status.State); Assert.NotNull(test.Status.Message);
        Assert.True(File.Exists(test.Status.AudioPath));
        Assert.Equal(HttpStatusCode.Conflict, (await Client.PostAsJsonAsync($"/api/recording-input/test/{test.Status.Id}/assessment", new { notes = "Verified" })).StatusCode);
    }

    [Fact]
    public async Task Empty_capture_fails_cleanly_and_does_not_leave_a_wav_or_temporary_file()
    {
        (await Start(Guid.NewGuid())).EnsureSuccessStatusCode(); await WaitFor(() => inputs.Capture.Started);
        await test.StopAsync(CancellationToken.None);
        Assert.Equal("Failed", test.Status.State); Assert.Contains("No audio frames", test.Status.Message);
        Assert.Empty(Directory.GetFiles(Path.Combine(root, "clips")));
    }

    [Fact]
    public async Task Busy_or_denied_driver_failure_never_opens_a_different_input()
    {
        inputs.OpenError = new UnauthorizedAccessException();
        (await Start(Guid.NewGuid())).EnsureSuccessStatusCode();
        await WaitFor(() => test.Status.State == "Failed");
        Assert.Contains("Access denied", test.Status.Message); Assert.Equal(1, inputs.OpenCount);
        Assert.Equal("stereo-1", test.Status.EndpointId);
    }

    [Fact]
    public async Task Report_and_observations_survive_restart_and_missing_audio_is_explicit()
    {
        var id = Guid.NewGuid(); (await Start(id)).EnsureSuccessStatusCode(); await WaitFor(() => inputs.Capture.Started);
        inputs.Capture.Emit([0.1f, 0.2f]); await test.StopAsync(CancellationToken.None);
        (await Client.PostAsJsonAsync($"/api/recording-input/test/{id}/assessment", new { notes = "STREAM; test driver; both decks and channel faders heard; L/R checked" })).EnsureSuccessStatusCode();
        var restored = new RecordingInputTest(inputs, NullLogger<RecordingInputTest>.Instance, Path.Combine(root, "clips"));
        Assert.Equal(test.Status.Assessment, restored.Status.Assessment); Assert.Equal(id, restored.Status.Id);
        Assert.True(File.Exists(Path.Combine(root, "clips", $"{id:D}.json")));
        File.Delete(test.Status.AudioPath!);
        restored = new(inputs, NullLogger<RecordingInputTest>.Instance, Path.Combine(root, "clips"));
        Assert.False(restored.Status.HasAudio); Assert.Contains("missing", restored.Status.Message);
    }

    [Fact]
    public async Task Unsupported_mono_endpoint_is_rejected_before_capture()
    {
        inputs.Device = inputs.Device with { Channels = 1, CanTest = false, UnavailableReason = "Choose a stereo input." };
        Assert.Equal(HttpStatusCode.Conflict, (await Start(Guid.NewGuid())).StatusCode);
        Assert.Equal(0, inputs.OpenCount);
    }

    [Fact]
    public async Task Rejected_conflicting_start_does_not_change_saved_device()
    {
        (await Start(Guid.NewGuid())).EnsureSuccessStatusCode();
        await WaitFor(() => inputs.Capture.Started);
        inputs.Device = inputs.Device with { Id = "stereo-2" };
        Assert.Equal(HttpStatusCode.Conflict, (await Start(Guid.NewGuid(), "stereo-2")).StatusCode);
        Assert.Equal("stereo-1", settings.Current.RecordingInputEndpointId);
    }

    [Fact]
    public async Task Unwritable_destination_fails_before_opening_capture()
    {
        Directory.CreateDirectory(root);
        await File.WriteAllTextAsync(Path.Combine(root, "clips"), "not a directory");
        (await Start(Guid.NewGuid())).EnsureSuccessStatusCode();
        await WaitFor(() => test.Status.State == "Failed");
        Assert.Equal(0, inputs.OpenCount); Assert.False(test.Status.HasAudio);
        Assert.Contains("could not be saved", test.Status.Message);
    }

    [Fact]
    public async Task Existing_temporary_clip_is_never_deleted_by_a_conflicting_request()
    {
        var id = Guid.NewGuid(); var clips = Path.Combine(root, "clips");
        Directory.CreateDirectory(clips);
        var previous = Path.Combine(clips, $"{id:D}.wav.tmp");
        await File.WriteAllTextAsync(previous, "preserve previous session bytes");
        (await Start(id)).EnsureSuccessStatusCode(); await test.StopAsync(CancellationToken.None);
        Assert.Equal("Failed", test.Status.State); Assert.Equal(0, inputs.OpenCount);
        Assert.Equal("preserve previous session bytes", await File.ReadAllTextAsync(previous));
    }

    [Fact]
    public async Task Scanning_a_parent_directory_does_not_import_diagnostic_recordings()
    {
        var clips = Path.Combine(root, "recording-input-tests"); Directory.CreateDirectory(clips);
        await File.WriteAllBytesAsync(Path.Combine(clips, "test.wav"), [0]);
        var song = Path.Combine(root, "song.wav"); await File.WriteAllBytesAsync(song, [0]);
        Assert.Equal(new[] { song }, new FileScanner().EnumerateAudioFiles(root));
        Assert.Empty(new FileScanner().EnumerateAudioFiles(clips));
    }

    public async Task DisposeAsync()
    {
        await test.StopAsync(CancellationToken.None); await app.DisposeAsync();
        if (Directory.Exists(root)) Directory.Delete(root, true);
    }

    private sealed class Inputs : IRecordingInputDevices
    {
        public RecordingInputDevice Device = new("stereo-1", "Input 1 (test mixer)", "PCM 24-bit stereo", 8000, 2, true, null);
        public readonly Capture Capture = new();
        public int OpenCount;
        public Exception? OpenError;
        public IReadOnlyList<RecordingInputDevice> List() => [Device];
        public IWaveIn Open(string endpointId) { OpenCount++; Assert.Equal(Device.Id, endpointId); if (OpenError != null) throw OpenError; return Capture; }
    }
    private sealed class Capture : IWaveIn
    {
        public volatile bool Started;
        public WaveFormat WaveFormat { get; set; } = WaveFormat.CreateIeeeFloatWaveFormat(8000, 2);
        public event EventHandler<WaveInEventArgs>? DataAvailable;
        public event EventHandler<StoppedEventArgs>? RecordingStopped;
        public void StartRecording() => Started = true;
        public void StopRecording() => RecordingStopped?.Invoke(this, new(null));
        public void Fail(Exception error) => RecordingStopped?.Invoke(this, new(error));
        public void Emit(float[] samples)
        {
            var bytes = new byte[samples.Length * 4]; Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
            DataAvailable?.Invoke(this, new(bytes, bytes.Length));
        }
        public void Dispose() { }
    }
}
