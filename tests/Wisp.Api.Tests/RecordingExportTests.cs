using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Wisp.Api.Recordings;
using Wisp.Core.Recordings;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.FileSystem;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Tests;

public sealed partial class MixRecorderTests
{
    private RecordingExports Exports => app.Services.GetRequiredService<RecordingExports>();
    private MixExportRequest ExportRequest(string format = "mp3", bool list = false, int revision = 0) => new(Guid.NewGuid(), root, format, list, revision);
    private Task<HttpResponseMessage> Export(Guid id, MixExportRequest request) => Client.PostAsJsonAsync($"/api/recording-exports/{id}", request);
    private async Task<RecordingExport> ExportFinished(Guid id)
    {
        await Until(() => Exports.Status?.Id == id && Exports.Status.State != "Running");
        using var scope = app.Services.CreateScope();
        return (await scope.ServiceProvider.GetRequiredService<WispDbContext>().RecordingExports.FindAsync(id))!;
    }
    private sealed class ExportEncoder(Mp3Transcoder transcoder) : MixExportEncoder(transcoder)
    {
        public bool Hold, Fail;
        public readonly TaskCompletionSource Entered = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public readonly TaskCompletionSource Release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async Task Encode(string source, string output, string format, int rate, long bytes, string title, DateTime recordedAt,
            Action<double> progress, Action checkSpace, CancellationToken ct)
        {
            Entered.TrySetResult(); if (Hold) await Release.Task.WaitAsync(ct);
            if (Fail) throw new IOException("simulated encoder failure");
            await base.Encode(source, output, format, rate, bytes, title, recordedAt, progress, checkSpace, ct);
        }
    }

    [Theory]
    [InlineData("mp3")]
    [InlineData("wav")]
    [InlineData("master")]
    public async Task Mix_export_verifies_audio_preserves_master_review_and_retry_identity(string format)
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("WISP_TEST_FFMPEG"))) return;
        var session = await Record(); var source = RecordingWorkspace.AudioPath(session); var hash = await MixRecorder.Hash(source);
        (await Client.PostAsJsonAsync($"/api/recording-workspace/{session.Id}/review", new WorkspaceEndpoints.ReviewRequest(0, 5, [new(Guid.NewGuid(), .5, "Private note")]))).EnsureSuccessStatusCode();
        var before = await Client.GetStringAsync($"/api/recording-workspace/{session.Id}/review");
        var request = ExportRequest(format); (await Export(session.Id, request)).EnsureSuccessStatusCode();
        var row = await ExportFinished(request.RequestId); Assert.True(row.State == "Ready", row.Error);
        var output = Path.Combine(row.DirectoryPath, MixExportEncoder.FileName(format));
        Assert.True(File.Exists(output)); Assert.False(Directory.Exists(row.DirectoryPath + ".partial"));
        Assert.Equal(hash, await MixRecorder.Hash(source)); Assert.Equal(before, await Client.GetStringAsync($"/api/recording-workspace/{session.Id}/review"));
        if (format == "master") Assert.Equal(hash, row.OutputHash);
        else
        {
            using var tag = TagLib.File.Create(output); Assert.Equal("Practice", tag.Tag.Title);
            if (format == "mp3") Assert.Equal((uint)session.StartedAt.Year, tag.Tag.Year);
            else
            {
                var riff = System.Text.Encoding.UTF8.GetString(await File.ReadAllBytesAsync(output));
                Assert.Contains("ICRD", riff); Assert.Contains(session.StartedAt.ToString("yyyy-MM-dd"), riff); // TagLib's Year accessor only parses integer years.
            }
        }
        if (format == "mp3") MixExportEncoder.ValidateMp3(output);
        Assert.True(RecordingExports.Available(row)); Assert.Empty(new FileScanner().EnumerateAudioFiles(root));
        using var range = new HttpRequestMessage(HttpMethod.Get, $"/api/recording-exports/audio/{row.Id}"); range.Headers.Range = new(0, 63);
        var audio = await Client.SendAsync(range); Assert.Equal(HttpStatusCode.PartialContent, audio.StatusCode); Assert.Equal(64, (await audio.Content.ReadAsByteArrayAsync()).Length);
        (await Export(session.Id, request)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await Export(session.Id, request with { Format = format == "mp3" ? "wav" : "mp3" })).StatusCode);
        using (var scope = app.Services.CreateScope()) Assert.Single(await scope.ServiceProvider.GetRequiredService<WispDbContext>().RecordingExports.ToArrayAsync());
        var second = ExportRequest(format); (await Export(session.Id, second)).EnsureSuccessStatusCode();
        var next = await ExportFinished(second.RequestId); Assert.Equal("Ready", next.State); Assert.NotEqual(row.DirectoryPath, next.DirectoryPath); Assert.True(File.Exists(output));
        File.SetLastWriteTimeUtc(output, DateTime.UtcNow.AddHours(1)); Assert.False(RecordingExports.Available(row));
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/recording-exports/audio/{row.Id}")).StatusCode);
    }

    [Fact]
    public async Task Export_tracklist_is_a_revision_checked_snapshot_not_the_blueprint_or_private_feedback()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("WISP_TEST_FFMPEG"))) return;
        var session = await Record();
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
            db.RecordingTracklists.Add(new() { Id = session.Id, Revision = 2, EntriesJson = JsonSerializer.Serialize(new PerformedEntry[] {
                new(Guid.NewGuid(), null, "Artist", "Later", true, 1.2, null), new(Guid.NewGuid(), null, "Artist", "Repeat", true, 0, null),
                new(Guid.NewGuid(), null, "Artist", "Repeat", true, .5, null), new(Guid.NewGuid(), null, "Artist", "Untimed track", true, null, null),
                new(Guid.NewGuid(), null, "Artist", "Not played", false, null, null) }) }); await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Conflict, (await Export(session.Id, ExportRequest("mp3", true, 1))).StatusCode);
        var request = ExportRequest("mp3", true, 2); (await Export(session.Id, request)).EnsureSuccessStatusCode();
        var row = await ExportFinished(request.RequestId); Assert.True(row.State == "Ready", row.Error);
        var text = await File.ReadAllTextAsync(Path.Combine(row.DirectoryPath, "tracklist.txt"));
        Assert.Equal(row.TracklistText, text); Assert.Contains("00:00:00.000", text); Assert.Contains("00:00:01.200", text);
        Assert.True(text.IndexOf("Repeat", StringComparison.Ordinal) < text.IndexOf("Later", StringComparison.Ordinal));
        Assert.Equal(2, text.Split("Repeat").Length - 1); Assert.Contains("Untimed  Artist", text); Assert.DoesNotContain("Not played", text);
        using var check = app.Services.CreateScope(); var db2 = check.ServiceProvider.GetRequiredService<WispDbContext>();
        (await db2.RecordingTracklists.FindAsync(session.Id))!.EntriesJson = "[]"; await db2.SaveChangesAsync();
        Assert.Equal(text, await File.ReadAllTextAsync(Path.Combine(row.DirectoryPath, "tracklist.txt")));
    }

    [Fact]
    public async Task Export_preflight_rejects_space_invalid_format_active_capture_and_large_standard_wav()
    {
        var session = await Record();
        Assert.Equal(HttpStatusCode.BadRequest, (await Export(session.Id, ExportRequest("flac"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Export(session.Id, ExportRequest() with { Folder = "relative" })).StatusCode);
        disk.Available = RecordingDiskStore.ReserveBytes;
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Export(session.Id, ExportRequest())).StatusCode); disk.Available = long.MaxValue / 2;
        using (lease.Acquire()) Assert.Equal(HttpStatusCode.Conflict, (await Export(session.Id, ExportRequest())).StatusCode);
        using var scope = app.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        var row = (await db.RecordingSessions.FindAsync(session.Id))!; row.AudioBytes = 8L * 1024 * 1024 * 1024; await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await Export(session.Id, ExportRequest("wav"))).StatusCode);
        Assert.Empty(await db.RecordingExports.ToArrayAsync());
    }

    [Fact]
    public async Task Changed_master_fails_without_publishing_and_cancelled_export_releases_input()
    {
        var s = await Record(); var source = RecordingWorkspace.AudioPath(s); var original = await File.ReadAllBytesAsync(source);
        using (var file = new FileStream(source, FileMode.Open, FileAccess.Write)) { file.Position = 100; file.WriteByte(123); }
        var request = ExportRequest(); (await Export(s.Id, request)).EnsureSuccessStatusCode(); var row = await ExportFinished(request.RequestId);
        Assert.Equal("Failed", row.State); Assert.Contains("master changed", row.Error); Assert.False(Directory.Exists(row.DirectoryPath));
        await File.WriteAllBytesAsync(source, original); exportEncoder.Hold = true;
        request = ExportRequest(); await Exports.Start(s.Id, request); await exportEncoder.Entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Throws<InvalidOperationException>(() => lease.Acquire());
        await Exports.Cancel(request.RequestId); row = await ExportFinished(request.RequestId);
        Assert.Equal("Cancelled", row.State); Assert.False(Directory.Exists(row.DirectoryPath + ".partial")); using var acquired = lease.Acquire();
    }

    [Fact]
    public async Task Restart_removes_only_owned_partials_keeps_published_packages_and_refuses_lossy_downgrade()
    {
        var s = await Record(); var id = Guid.NewGuid(); var parent = Path.Combine(root, MixExportEncoder.FolderName);
        var output = Path.Combine(parent, "Mix " + id.ToString("N")); var partial = output + ".partial";
        Directory.CreateDirectory(partial); await File.WriteAllBytesAsync(Path.Combine(partial, "owner"), id.ToByteArray());
        await File.WriteAllTextAsync(Path.Combine(partial, "mix.mp3"), "partial");
        Directory.CreateDirectory(output); await File.WriteAllTextAsync(Path.Combine(output, "mix.mp3"), "keep completed");
        using var scope = app.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        db.RecordingExports.Add(new() { Id = id, RecordingId = s.Id, DirectoryPath = output }); await db.SaveChangesAsync();
        await Exports.StartAsync(CancellationToken.None); Assert.False(Directory.Exists(partial));
        Assert.Equal("keep completed", await File.ReadAllTextAsync(Path.Combine(output, "mix.mp3")));
        db.ChangeTracker.Clear(); var row = (await db.RecordingExports.FindAsync(id))!; Assert.Equal("Interrupted", row.State);
        var previous = db.Database.GetMigrations().TakeWhile(m => !m.EndsWith("_AddRecordingExports")).Last();
        await Assert.ThrowsAnyAsync<Exception>(() => db.GetService<IMigrator>().MigrateAsync(previous)); Assert.Single(await db.RecordingExports.ToArrayAsync());
    }

    [Theory]
    [InlineData(true)] [InlineData(false)]
    public async Task Encoder_failure_or_disk_loss_cleans_owned_partial_and_keeps_unrelated_files(bool encoderFailure)
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("WISP_TEST_FFMPEG"))) return;
        var s = await Record(); var exporter = Exports; exportEncoder.Hold = true; exportEncoder.Fail = encoderFailure;
        var sentinel = Path.Combine(root, "keep.txt"); await File.WriteAllTextAsync(sentinel, "keep");
        var request = ExportRequest(); await exporter.Start(s.Id, request); await exportEncoder.Entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        if (!encoderFailure) disk.Available = 0;
        exportEncoder.Release.TrySetResult(); var row = await ExportFinished(request.RequestId);
        Assert.Equal("Failed", row.State); Assert.False(Directory.Exists(row.DirectoryPath)); Assert.False(Directory.Exists(row.DirectoryPath + ".partial"));
        Assert.Equal("keep", await File.ReadAllTextAsync(sentinel)); Assert.Equal(s.AudioHash, await MixRecorder.Hash(RecordingWorkspace.AudioPath(s)));
        using var acquired = lease.Acquire();
    }

    [Fact]
    public async Task Export_commit_failure_retains_published_audio_and_restart_never_overwrites_it()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("WISP_TEST_FFMPEG"))) return;
        var s = await Record(); saveFault.FailExportReady = true;
        var request = ExportRequest(); (await Export(s.Id, request)).EnsureSuccessStatusCode();
        var row = await ExportFinished(request.RequestId); Assert.Equal("Failed", Exports.Status!.State); Assert.Equal("Running", row.State);
        var output = Path.Combine(row.DirectoryPath, "mix.mp3"); var hash = await MixRecorder.Hash(output);
        Assert.Contains("status could not be saved", Exports.Status.Error); saveFault.FailExportReady = false;
        await Exports.StartAsync(CancellationToken.None); Assert.Equal(hash, await MixRecorder.Hash(output));
        var retried = await Exports.Start(s.Id, request); Assert.Equal("Interrupted", retried.State);
        request = ExportRequest(); await Exports.Start(s.Id, request); var next = await ExportFinished(request.RequestId);
        Assert.Equal("Ready", next.State); Assert.NotEqual(row.DirectoryPath, next.DirectoryPath); Assert.Equal(hash, await MixRecorder.Hash(output));
    }

    [Fact]
    public async Task Cancel_preserves_unrecognised_partial_content_instead_of_recursively_deleting_it()
    {
        var s = await Record(); var exporter = Exports; exportEncoder.Hold = true;
        var request = ExportRequest(); var row = await exporter.Start(s.Id, request); await exportEncoder.Entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        var unknown = Path.Combine(row.DirectoryPath + ".partial", "user-file.txt"); await File.WriteAllTextAsync(unknown, "keep");
        await exporter.Cancel(request.RequestId); row = await ExportFinished(request.RequestId);
        Assert.Equal("Cancelled", row.State); Assert.Contains("retained", row.Error); Assert.Equal("keep", await File.ReadAllTextAsync(unknown));
    }
}
