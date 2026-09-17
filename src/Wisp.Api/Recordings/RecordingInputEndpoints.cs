using Wisp.Api.Settings;
using Wisp.Infrastructure.Audio;

namespace Wisp.Api.Recordings;

public static class RecordingInputEndpoints
{
    public sealed record StartRequest(Guid RequestId, string EndpointId);
    public sealed record AssessmentRequest(string Notes);

    public static void MapRecordingInputs(this WebApplication app)
    {
        var group = app.MapGroup("/api/recording-input");
        group.MapGet("/devices", (IRecordingInputDevices devices, WispSettingsStore settings) =>
            Guard(() => Results.Ok(new { devices = devices.List(), selectedEndpointId = settings.Current.RecordingInputEndpointId })));
        group.MapGet("/test", (RecordingInputTest test) => Results.Ok(test.Status));
        group.MapPost("/test", (StartRequest request, IRecordingInputDevices devices,
            WispSettingsStore settings, RecordingInputTest test) => Guard(() =>
        {
            if (request.RequestId == Guid.Empty || string.IsNullOrWhiteSpace(request.EndpointId))
                throw new ArgumentException("Choose a specific input before starting a test.");
            var device = devices.List().FirstOrDefault(x => x.Id == request.EndpointId)
                ?? throw new InvalidOperationException("The selected input is disconnected. Refresh inputs and reconnect it.");
            if (!device.CanTest) throw new InvalidOperationException(device.UnavailableReason);
            // Save before capture; a settings failure must not start an invisible test.
            return Results.Ok(test.Start(request.RequestId, device,
                () => settings.Update(s => s with { RecordingInputEndpointId = device.Id })));
        }));
        group.MapPost("/test/{id:guid}/stop", (Guid id, RecordingInputTest test) => Guard(() => Results.Ok(test.Stop(id))));
        group.MapPost("/test/{id:guid}/assessment", (Guid id, AssessmentRequest request, RecordingInputTest test) => Guard(() =>
        {
            test.Assess(id, request.Notes);
            return Results.Ok(test.Status);
        }));
        group.MapGet("/test/{id:guid}/audio", (Guid id, RecordingInputTest test) =>
            test.AudioPath(id) is { } path
                ? Results.File(path, "audio/wav", enableRangeProcessing: true) : Results.NotFound());
    }

    private static IResult Guard(Func<IResult> action)
    {
        try { return action(); }
        catch (ArgumentException ex) { return Error(400, ex.Message); }
        catch (InvalidOperationException ex) { return Error(409, ex.Message); }
        catch (PlatformNotSupportedException) { return Error(422, "Recording input tests require Windows."); }
        catch (UnauthorizedAccessException) { return Error(422, "Check Windows desktop microphone permissions and access to WISP's settings folder."); }
        catch (IOException) { return Error(422, "Could not save input settings. Check free space and folder permissions."); }
        catch (System.Runtime.InteropServices.COMException) { return Error(422, "Could not access Windows audio inputs. Reconnect the mixer and check Windows Sound settings."); }
    }
    private static IResult Error(int status, string message) => Results.Json(new { code = "recording_input", message }, statusCode: status);
}
