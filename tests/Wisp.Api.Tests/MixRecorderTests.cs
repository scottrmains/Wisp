using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NAudio.Wave;
using Wisp.Api.Recordings;
using Wisp.Api.Settings;
using Wisp.Core.Recordings;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.FileSystem;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Tests;

public sealed class MixRecorderTests : IAsyncLifetime
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "wisp-mix-recorder-" + Guid.NewGuid().ToString("N"));
    private readonly Devices devices = new();
    private readonly FaultDisk disk = new();
    private readonly CaptureLease lease = new();
    private readonly SaveFault saveFault = new();
    private WebApplication app = null!;
    private MixRecorder recorder = null!;
    private HttpClient Client => app.GetTestClient();

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(root);
        var builder = WebApplication.CreateBuilder(); builder.WebHost.UseTestServer();
        builder.Services.AddDbContext<WispDbContext>(o => o.UseSqlite($"Data Source={Path.Combine(root, "isolated.db")};Pooling=False").AddInterceptors(saveFault));
        builder.Services.AddSingleton<IRecordingInputDevices>(devices); builder.Services.AddSingleton<RecordingDiskStore>(disk);
        builder.Services.AddSingleton(lease); builder.Services.AddSingleton<MixRecorder>();
        builder.Services.AddSingleton(new WispSettingsStore(Path.Combine(root, "settings.json")));
        app = builder.Build(); app.MapRecordings();
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
            await db.Database.MigrateAsync(); Assert.False(db.Database.HasPendingModelChanges());
        }
        recorder = app.Services.GetRequiredService<MixRecorder>();
        await recorder.StartAsync(CancellationToken.None); await app.StartAsync();
    }
    private Task<HttpResponseMessage> Start(Guid id, Guid? previous = null) => Client.PostAsJsonAsync("/api/recordings/start",
        new { requestId = id, title = "Practice", folder = root, endpointId = "stereo", previousTakeId = previous });
    private static async Task Until(Func<bool> test)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (!test()) await Task.Delay(10, timeout.Token);
    }
    private async Task<RecordingSession> Record()
    {
        var id = Guid.NewGuid(); (await Start(id)).EnsureSuccessStatusCode(); await Until(() => devices.Last?.Started == true);
        for (var n = 0; n < 12; n++) { devices.Last!.Emit(); await Task.Delay(10); }
        recorder.Stop(id); await Until(() => !recorder.Status.Busy);
        Assert.Equal("Ready", recorder.Status.Session!.State);
        return recorder.Status.Session;
    }

    [Fact]
    public async Task Streams_stereo_master_and_saves_metadata_without_library_import()
    {
        var session = await Record(); var path = Path.Combine(session.DirectoryPath, "master.wav");
        Assert.Equal(1.2, recorder.Status.SavedSeconds, 3); Assert.NotNull(session.AudioHash);
        RecordingDiskStore.Validate(path, 8000, 12 * 6400);
        using var reader = new WaveFileReader(path);
        Assert.Equal(new[] { 0.25f, -0.5f }, reader.ReadNextSampleFrame());
        Assert.Empty(new FileScanner().EnumerateAudioFiles(root));
        using var scope = app.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        Assert.Equal("Ready", (await db.RecordingSessions.SingleAsync()).State); Assert.Empty(await db.Tracks.ToArrayAsync());
        Assert.Equal(HttpStatusCode.OK, (await Client.GetAsync($"/api/recordings/{session.Id}/audio")).StatusCode);
    }

    [Fact]
    public async Task Retried_start_and_stop_are_idempotent_and_short_test_cannot_compete()
    {
        var id = Guid.NewGuid(); (await Start(id)).EnsureSuccessStatusCode(); (await Start(id)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await Start(Guid.NewGuid())).StatusCode);
        var shortTest = new RecordingInputTest(devices, NullLogger<RecordingInputTest>.Instance, Path.Combine(root, "short"), lease);
        Assert.Throws<InvalidOperationException>(() => shortTest.Start(Guid.NewGuid(), devices.List()[0]));
        await Until(() => devices.Last?.Started == true); devices.Last!.Emit(); recorder.Stop(id); recorder.Stop(id);
        await Until(() => !recorder.Status.Busy); Assert.Equal(1, devices.OpenCount);
        Assert.Equal(HttpStatusCode.Conflict, (await Client.PostAsync($"/api/recordings/{Guid.NewGuid()}/stop", null)).StatusCode);
    }

    [Fact]
    public async Task Close_request_keeps_recording_until_explicit_stop_and_save()
    {
        var id = Guid.NewGuid(); (await Start(id)).EnsureSuccessStatusCode(); await Until(() => devices.Last?.Started == true);
        Assert.True(recorder.RequestClose()); Assert.True(recorder.Status.Busy);
        Assert.Throws<InvalidOperationException>(recorder.PrepareClose);
        recorder.KeepRecording(); Assert.False(recorder.Status.CloseRequested);
        devices.Last!.Emit(); recorder.Stop(id); await Until(() => !recorder.Status.Busy);
        recorder.PrepareClose(); Assert.Equal(HttpStatusCode.Conflict, (await Start(Guid.NewGuid())).StatusCode);
    }

    [Fact]
    public async Task Hung_native_stop_keeps_lease_until_driver_exits_and_preserves_checkpoint()
    {
        var id = Guid.NewGuid(); (await Start(id)).EnsureSuccessStatusCode(); await Until(() => devices.Last?.Started == true);
        var capture = devices.Last!;
        using var release = new ManualResetEventSlim(false);
        capture.StopGate = release;
        try
        {
            for (var n = 0; n < 12; n++) { capture.Emit(); await Task.Delay(10); }
            recorder.Stop(id);
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            while (recorder.Status.Busy) await Task.Delay(25, deadline.Token);
            Assert.Equal("Recoverable", recorder.Status.Session!.State);
            Assert.Contains("driver", recorder.Status.Session.Issue);
            Assert.Throws<InvalidOperationException>(() => lease.Acquire());
            (await Client.PostAsync($"/api/recordings/{id}/recover", null)).EnsureSuccessStatusCode();
            Assert.Equal(12 * 6400, recorder.Status.Session.AudioBytes);
        }
        finally { release.Set(); }
        await Until(() => capture.Disposed);
        await Until(() => { try { using var acquired = lease.Acquire(); return true; } catch (InvalidOperationException) { return false; } });
    }

    [Fact]
    public async Task Write_failure_retains_checkpoint_and_recovers_without_stitching_a_new_take()
    {
        disk.FailAtCheckpoint = 3;
        var id = Guid.NewGuid(); (await Start(id)).EnsureSuccessStatusCode(); await Until(() => devices.Last?.Started == true);
        for (var n = 0; n < 25 && recorder.Status.Busy; n++) { devices.Last!.Emit(); await Task.Delay(10); }
        await Until(() => !recorder.Status.Busy);
        Assert.Equal("Recoverable", recorder.Status.Session!.State);
        disk.FailAtCheckpoint = int.MaxValue;
        (await Client.PostAsync($"/api/recordings/{id}/recover", null)).EnsureSuccessStatusCode();
        var session = recorder.Status.Session!;
        Assert.Equal(64000, session.AudioBytes); Assert.NotNull(session.Issue);
        RecordingDiskStore.Validate(Path.Combine(session.DirectoryPath, "master.wav"), 8000, 64000);
        var next = Guid.NewGuid(); (await Start(next, id)).EnsureSuccessStatusCode();
        Assert.Equal(id, recorder.Status.Session!.PreviousTakeId); Assert.NotEqual(session.DirectoryPath, recorder.Status.Session.DirectoryPath);
    }

    [Fact]
    public async Task Rename_failure_after_final_checkpoint_is_retryable_and_original_bytes_remain()
    {
        disk.FailPromote = true; var id = Guid.NewGuid();
        (await Start(id)).EnsureSuccessStatusCode(); await Until(() => devices.Last?.Started == true);
        devices.Last!.Emit(); recorder.Stop(id); await Until(() => !recorder.Status.Busy);
        var folder = recorder.Status.Session!.DirectoryPath; var bytes = File.ReadAllBytes(Path.Combine(folder, "master.wav.partial"));
        disk.FailPromote = false; await recorder.Recover(id); await recorder.Recover(id);
        Assert.Equal(bytes, File.ReadAllBytes(Path.Combine(folder, "master.wav")));
    }

    [Fact]
    public async Task Device_loss_is_explicit_and_never_switches_inputs()
    {
        (await Start(Guid.NewGuid())).EnsureSuccessStatusCode(); await Until(() => devices.Last?.Started == true);
        devices.Last!.Emit(); devices.Last.Fail(); await Until(() => !recorder.Status.Busy);
        Assert.Equal(1, devices.OpenCount); Assert.Equal("Ready", recorder.Status.Session!.State);
        Assert.Contains("device", recorder.Status.Session.Issue!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Disk_reserve_preflight_and_mid_recording_stop_are_safe()
    {
        disk.Available = 1; Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Start(Guid.NewGuid())).StatusCode); Assert.Equal(0, devices.OpenCount);
        disk.Available = long.MaxValue / 2; (await Start(Guid.NewGuid())).EnsureSuccessStatusCode(); await Until(() => devices.Last?.Started == true);
        disk.Available = 1;
        for (var n = 0; n < 11; n++) { devices.Last!.Emit(); await Task.Delay(10); }
        await Until(() => !recorder.Status.Busy); Assert.Equal("Recoverable", recorder.Status.Session!.State);
        disk.Available = long.MaxValue / 2; await recorder.Recover(recorder.Status.Session.Id);
        Assert.True(recorder.Status.Session.AudioBytes > 0);
    }

    [Fact]
    public async Task Remove_entry_keeps_master_and_relink_never_allows_deleting_external_copy()
    {
        var session = await Record(); var managed = Path.Combine(session.DirectoryPath, "master.wav");
        var external = Path.Combine(root, "relocated.wav"); File.Copy(managed, external);
        (await Client.PostAsJsonAsync($"/api/recordings/{session.Id}/relink", new { path = external })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.PostAsJsonAsync($"/api/recordings/{session.Id}/remove", new { deleteAudio = true, confirmed = false })).StatusCode);
        (await Client.PostAsJsonAsync($"/api/recordings/{session.Id}/remove", new { deleteAudio = false, confirmed = true })).EnsureSuccessStatusCode();
        Assert.True(File.Exists(managed)); Assert.Empty((await Client.GetFromJsonAsync<RecordingSession[]>("/api/recordings/"))!);
        (await Client.PostAsJsonAsync($"/api/recordings/{session.Id}/remove", new { deleteAudio = true, confirmed = true })).EnsureSuccessStatusCode();
        Assert.False(File.Exists(managed)); Assert.True(File.Exists(external));
    }

    [Fact]
    public async Task Restart_marks_incomplete_sessions_recoverable_without_touching_audio()
    {
        var id = Guid.NewGuid(); var folder = disk.NewDirectory(root, id);
        using (var output = disk.CreateAudio(folder))
        {
            output.Write(RecordingDiskStore.Header(8000, 0)); output.Write(new byte[64000]);
            disk.Checkpoint(folder, output, new(1, id, 8000, 64000, "Recording", null, DateTime.UtcNow));
            output.Write(new byte[100]); // Uncommitted tail: recovery must ignore this.
        }
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
            db.RecordingSessions.Add(new() { Id = id, Title = "Interrupted", DirectoryPath = folder, SampleRate = 8000, State = "Recording" }); await db.SaveChangesAsync();
        }
        await recorder.StartAsync(CancellationToken.None);
        var rows = await Client.GetFromJsonAsync<RecordingSession[]>("/api/recordings/"); Assert.Equal("Recoverable", Assert.Single(rows!).State);
        await recorder.Recover(id); RecordingDiskStore.Validate(Path.Combine(folder, "master.wav"), 8000, 64000);
    }

    [Fact]
    public async Task Oversized_packets_fail_visibly_instead_of_unbounded_allocation()
    {
        (await Start(Guid.NewGuid())).EnsureSuccessStatusCode(); await Until(() => devices.Last?.Started == true);
        devices.Last!.Emit(64000); await Until(() => !recorder.Status.Busy);
        Assert.Equal("Failed", recorder.Status.Session!.State); Assert.Contains("oversized", recorder.Status.Session.Issue!);
    }

    [Fact]
    public async Task Bounded_queue_overrun_stops_and_preserves_every_accepted_packet()
    {
        (await Start(Guid.NewGuid())).EnsureSuccessStatusCode(); await Until(() => devices.Last?.Started == true);
        disk.Release.Reset();
        for (var n = 0; n < 10; n++) { devices.Last!.Emit(); await Task.Delay(10); }
        await Until(() => disk.Blocked.IsSet);
        for (var n = 0; n < 1000; n++) devices.Last!.Emit();
        Assert.True(recorder.Status.Seconds <= 6); // independent of attempted mix length
        disk.Release.Set(); await Until(() => !recorder.Status.Busy);
        Assert.Equal("Ready", recorder.Status.Session!.State);
        Assert.Contains("could not keep up", recorder.Status.Session.Issue!);
        Assert.Equal(recorder.Status.Seconds, recorder.Status.SavedSeconds);
    }

    [Fact]
    public async Task Database_failure_after_master_promotion_is_recoverable_without_reencoding()
    {
        saveFault.FailReady = true;
        var id = Guid.NewGuid(); (await Start(id)).EnsureSuccessStatusCode(); await Until(() => devices.Last?.Started == true);
        devices.Last!.Emit(); recorder.Stop(id); await Until(() => !recorder.Status.Busy);
        Assert.Equal("Recoverable", recorder.Status.Session!.State);
        var path = Path.Combine(recorder.Status.Session.DirectoryPath, "master.wav"); var original = File.ReadAllBytes(path);
        saveFault.FailReady = false; await recorder.Recover(id);
        Assert.Equal("Ready", recorder.Status.Session.State); Assert.Equal(original, File.ReadAllBytes(path));
    }

    [Fact]
    public async Task Missing_audio_watchdog_stops_without_resuming_or_falling_back()
    {
        (await Start(Guid.NewGuid())).EnsureSuccessStatusCode(); await Until(() => devices.Last?.Started == true);
        await Until(() => !recorder.Status.Busy);
        Assert.Equal("Failed", recorder.Status.Session!.State); Assert.Contains("No audio arrived", recorder.Status.Session.Issue!);
        Assert.Equal(1, devices.OpenCount);
    }

    public async Task DisposeAsync()
    {
        disk.Release.Set(); await recorder.StopAsync(CancellationToken.None); await app.DisposeAsync();
        if (Directory.Exists(root)) Directory.Delete(root, true);
    }

    private sealed class Devices : IRecordingInputDevices
    {
        public Capture? Last; public int OpenCount;
        public IReadOnlyList<RecordingInputDevice> List() => [new("stereo", "Test stereo", "Float", 8000, 2, true, null)];
        public IWaveIn Open(string id) { Assert.Equal("stereo", id); OpenCount++; return Last = new(); }
    }
    private sealed class Capture : IWaveIn
    {
        public volatile bool Started;
        public volatile bool Disposed;
        public ManualResetEventSlim? StopGate;
        public WaveFormat WaveFormat { get; set; } = WaveFormat.CreateIeeeFloatWaveFormat(8000, 2);
        public event EventHandler<WaveInEventArgs>? DataAvailable;
        public event EventHandler<StoppedEventArgs>? RecordingStopped;
        public void StartRecording() => Started = true;
        public void StopRecording() { StopGate?.Wait(); RecordingStopped?.Invoke(this, new(null)); }
        public void Fail() => RecordingStopped?.Invoke(this, new(new IOException("unplugged")));
        public void Emit(int length = 6400)
        {
            var floats = new float[length / 4]; for (var i = 0; i < floats.Length; i++) floats[i] = i % 2 == 0 ? .25f : -.5f;
            var bytes = new byte[length]; Buffer.BlockCopy(floats, 0, bytes, 0, length); DataAvailable?.Invoke(this, new(bytes, length));
        }
        public void Dispose() => Disposed = true;
    }
    private sealed class FaultDisk : RecordingDiskStore
    {
        public int FailAtCheckpoint = int.MaxValue, Count;
        public bool FailPromote;
        public long Available = long.MaxValue / 2;
        public readonly ManualResetEventSlim Release = new(true);
        public readonly ManualResetEventSlim Blocked = new(false);
        public override long FreeBytes(string folder) => Available;
        public override void Checkpoint(string directory, Stream stream, RecordingCheckpoint value)
        {
            if (!Release.IsSet) Blocked.Set();
            Release.Wait(); if (++Count == FailAtCheckpoint) throw new IOException("simulated disk failure");
            base.Checkpoint(directory, stream, value);
        }
        public override string Promote(string directory) => FailPromote ? throw new IOException("simulated rename failure") : base.Promote(directory);
    }
    private sealed class SaveFault : SaveChangesInterceptor
    {
        public bool FailReady;
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (FailReady && eventData.Context!.ChangeTracker.Entries<RecordingSession>().Any(e => e.Entity.State == "Ready"))
                throw new IOException("simulated database commit failure");
            return ValueTask.FromResult(result);
        }
    }
}
