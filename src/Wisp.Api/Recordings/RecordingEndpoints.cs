using Microsoft.EntityFrameworkCore;
using Wisp.Api.Settings;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Recordings;

public static class RecordingEndpoints
{
    public sealed record StartRequest(Guid RequestId, string Title, string Folder, string EndpointId, Guid? PreviousTakeId);
    public sealed record DeleteRequest(bool DeleteAudio, bool Confirmed);
    public sealed record RelinkRequest(string Path);

    public static void MapRecordings(this WebApplication app)
    {
        var routes = app.MapGroup("/api/recordings");
        routes.MapGet("/status", (MixRecorder recorder) => Results.Ok(recorder.Status));
        routes.MapGet("/settings", (WispSettingsStore settings) => Results.Ok(new { folder = settings.Current.RecordingFolder }));
        routes.MapGet("/", async (WispDbContext db) => Results.Ok(await db.RecordingSessions.AsNoTracking()
            .Where(r => !r.Hidden && r.State != "Deleted").OrderByDescending(r => r.StartedAt).ToArrayAsync()));
        routes.MapPost("/start", (StartRequest request, MixRecorder recorder, WispSettingsStore settings) => Guard(async () =>
        {
            var session = await recorder.Start(request.RequestId, request.Title, request.Folder, request.EndpointId, request.PreviousTakeId);
            // Capture is already visible in status if remembering the preference fails.
            try { settings.Update(s => s with { RecordingFolder = request.Folder, RecordingInputEndpointId = request.EndpointId }); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            { /* The registered session retains the authoritative destination. */ }
            return Results.Ok(session);
        }));
        routes.MapPost("/{id:guid}/stop", (Guid id, MixRecorder recorder) => Guard(() =>
        { recorder.Stop(id); return Task.FromResult<IResult>(Results.Ok(recorder.Status)); }));
        routes.MapPost("/keep-recording", (MixRecorder recorder) => { recorder.KeepRecording(); return Results.NoContent(); });
        routes.MapPost("/{id:guid}/recover", (Guid id, MixRecorder recorder) => Guard(async () =>
        { await recorder.Recover(id); return Results.NoContent(); }));
        routes.MapGet("/{id:guid}/audio", (Guid id, WispDbContext db) => Guard(async () =>
        {
            var session = await db.RecordingSessions.FindAsync(id);
            if (session == null || session.State != "Ready") return Results.NotFound();
            var path = session.RelinkedPath ?? Path.Combine(session.DirectoryPath, "master.wav");
            if (!File.Exists(path)) return Results.NotFound(new { message = "Master is missing. Reconnect its drive or relink the original file." });
            return Results.File(path, "audio/wav", enableRangeProcessing: true);
        }));
        routes.MapPost("/{id:guid}/relink", (Guid id, RelinkRequest request, MixRecorder recorder, WispDbContext db) => Guard(() => recorder.WhenIdle<IResult>(async () =>
        {
            if (recorder.Status.Busy) throw new InvalidOperationException("Stop recording before relinking a master.");
            var session = await db.RecordingSessions.FindAsync(id);
            if (session == null || session.State != "Ready" || session.AudioHash == null) return Results.NotFound();
            if (!System.IO.Path.IsPathFullyQualified(request.Path)) throw new ArgumentException("Choose the absolute path to the original master.");
            RecordingDiskStore.Validate(request.Path, session.SampleRate, session.AudioBytes);
            if (await MixRecorder.Hash(request.Path) != session.AudioHash)
                throw new InvalidOperationException("That file is not byte-identical to this master. Nothing was changed.");
            session.RelinkedPath = System.IO.Path.GetFullPath(request.Path); await db.SaveChangesAsync();
            return Results.NoContent();
        })));
        routes.MapPost("/{id:guid}/remove", (Guid id, DeleteRequest request, MixRecorder recorder, WispDbContext db, RecordingDiskStore disk) => Guard(() => recorder.WhenIdle<IResult>(async () =>
        {
            if (!request.Confirmed) throw new ArgumentException("Confirm whether to remove the entry or permanently delete its managed audio.");
            if (recorder.Status.Busy) throw new InvalidOperationException("Stop recording before removing a take.");
            var session = await db.RecordingSessions.FindAsync(id);
            if (session == null) return Results.NotFound();
            if (request.DeleteAudio)
            {
                if (session.State is not ("Ready" or "Deleted")) throw new InvalidOperationException("Recover this take before deleting audio.");
                // Only our fixed managed audio files. Never recurse, delete a parent,
                // or follow a relinked master path into somebody else's music.
                var directory = Path.GetFullPath(session.DirectoryPath);
                if (Path.GetFileName(directory) != id.ToString("D") || Path.GetFileName(Path.GetDirectoryName(directory)) != RecordingDiskStore.FolderName)
                    throw new InvalidOperationException("The managed recording directory does not match this take.");
                RecordingDiskStore.RejectLinks(directory);
                if (Directory.Exists(directory))
                {
                    disk.Read(directory, id, session.SampleRate);
                    foreach (var name in new[] { "master.wav", "master.wav.partial", "original.wav", "original.mp3", "original.flac", "original.aiff", "original.aif" }) File.Delete(Path.Combine(directory, name));
                }
                session.State = "Deleted";
            }
            session.Hidden = true; await db.SaveChangesAsync();
            return Results.NoContent();
        })));
    }

    private static async Task<IResult> Guard(Func<Task<IResult>> action)
    {
        try { return await action(); }
        catch (ArgumentException ex) { return Results.Json(new { message = ex.Message }, statusCode: 400); }
        catch (InvalidOperationException ex) { return Results.Json(new { message = ex.Message }, statusCode: 409); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException or System.Runtime.InteropServices.COMException)
        { return Results.Json(new { message = MixRecorder.SafeMessage(ex) }, statusCode: 422); }
    }
}
