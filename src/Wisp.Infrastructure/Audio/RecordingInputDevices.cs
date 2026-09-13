using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace Wisp.Infrastructure.Audio;

public sealed record RecordingInputDevice(string Id, string Name, string? MixFormat,
    int SampleRate, int Channels, bool CanTest, string? UnavailableReason);

public interface IRecordingInputDevices
{
    IReadOnlyList<RecordingInputDevice> List();
    IWaveIn Open(string endpointId);
}

/// Only explicit capture endpoints, never render/loopback or the system default.
public sealed class RecordingInputDevices : IRecordingInputDevices
{
    public IReadOnlyList<RecordingInputDevice> List()
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Recording input tests require Windows.");
        using var enumerator = new MMDeviceEnumerator();
        var result = new List<RecordingInputDevice>();
        foreach (var endpoint in enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
        {
            using (endpoint)
            {
                try
                {
                    using var client = endpoint.AudioClient;
                    var format = client.MixFormat;
                    // The proof uses the endpoint's shared sample rate, not a claim
                    // about its ADC precision or every format supported by its driver.
                    var canTest = format.Channels == 2 && format.SampleRate is >= 8000 and <= 192000;
                    result.Add(new(endpoint.ID, endpoint.FriendlyName, format.ToString(),
                        format.SampleRate, format.Channels, canTest,
                        canTest ? null : "Choose a stereo endpoint (8–192 kHz). Change its format in Windows Sound settings if needed."));
                }
                catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException or UnauthorizedAccessException)
                {
                    result.Add(new(endpoint.ID, endpoint.FriendlyName, null, 0, 0, false,
                        "Cannot read this input. Check Windows microphone permissions and reconnect the device."));
                }
            }
        }
        return result.OrderBy(x => x.Name).ToArray();
    }

    public IWaveIn Open(string endpointId)
    {
        var selected = List().FirstOrDefault(x => x.Id == endpointId)
            ?? throw new InvalidOperationException("The selected input is disconnected. Reconnect it or explicitly choose another input.");
        if (!selected.CanTest) throw new InvalidOperationException(selected.UnavailableReason);
        using var enumerator = new MMDeviceEnumerator();
        using var endpoint = enumerator.GetDevice(endpointId);
        var capture = new WasapiCapture(endpoint, false, 100);
        // Windows shared-mode conversion, same rate and two channels: no downmix,
        // gain or sample-rate up-conversion. Float is the API transport, not ADC bits.
        capture.WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(selected.SampleRate, 2);
        return capture;
    }
}
