using System.Diagnostics;
using Serilog;

namespace Wisp.Api;

/// Spawns the Vite dev server as a child process and waits for it to bind.
/// Used by the DevShell launch profile so a single F5 launches API + Vite + Photino.
public sealed class SpaSidecar : IAsyncDisposable
{
    private readonly Process _process;
    private readonly string _readyUrl;

    private SpaSidecar(Process process, string readyUrl)
    {
        _process = process;
        _readyUrl = readyUrl;
    }

    public static async Task<SpaSidecar> StartAsync(
        string command,
        string workingDirectory,
        string readyUrl,
        TimeSpan timeout,
        CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(workingDirectory))
            throw new DirectoryNotFoundException($"SPA working directory not found: {workingDirectory}");

        var psi = new ProcessStartInfo
        {
            // npm is a .cmd shim on Windows — go through cmd /c so resolution works without a full path.
            FileName = OperatingSystem.IsWindows() ? "cmd.exe" : "/bin/sh",
            Arguments = OperatingSystem.IsWindows() ? $"/c {command}" : $"-c \"{command}\"",
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) Log.Debug("[vite] {Line}", e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) Log.Debug("[vite] {Line}", e.Data); };

        Log.Information("Starting SPA sidecar: {Command} (cwd: {Cwd})", command, workingDirectory);
        if (!process.Start())
            throw new InvalidOperationException($"Failed to start SPA sidecar: {command}");

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        var sidecar = new SpaSidecar(process, readyUrl);

        try
        {
            await sidecar.WaitForReadyAsync(timeout, cancellationToken);
            Log.Information("SPA sidecar ready at {Url}", readyUrl);
            return sidecar;
        }
        catch
        {
            await sidecar.DisposeAsync();
            throw;
        }
    }

    private async Task WaitForReadyAsync(TimeSpan timeout, CancellationToken cancellationToken)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var deadline = DateTime.UtcNow + timeout;

        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (_process.HasExited)
                throw new InvalidOperationException($"SPA sidecar exited (code {_process.ExitCode}) before becoming ready");

            try
            {
                using var resp = await http.GetAsync(_readyUrl, cancellationToken);
                if ((int)resp.StatusCode < 500) return;
            }
            catch
            {
                // not up yet — keep polling
            }

            await Task.Delay(250, cancellationToken);
        }

        throw new TimeoutException($"SPA sidecar at {_readyUrl} did not become ready within {timeout.TotalSeconds:N0}s");
    }

    public async ValueTask DisposeAsync()
    {
        if (_process.HasExited)
        {
            _process.Dispose();
            return;
        }

        try
        {
            Log.Information("Stopping SPA sidecar (PID {Pid})", _process.Id);
            _process.Kill(entireProcessTree: true);
            await _process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to cleanly stop SPA sidecar");
        }
        finally
        {
            _process.Dispose();
        }
    }
}
