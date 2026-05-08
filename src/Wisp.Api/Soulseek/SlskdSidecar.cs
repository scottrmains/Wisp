using System.Diagnostics;
using System.Net.Sockets;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Wisp.Api.Settings;
using Wisp.Infrastructure;
using Wisp.Infrastructure.ExternalCatalog.Soulseek;

namespace Wisp.Api.Soulseek;

/// Hosted service that owns the bundled slskd.exe lifecycle. On startup:
///
///   1. **Migrate** credentials from any existing slskd.yml the user already had —
///      the very first time Wisp launches with the sidecar, this means they don't
///      have to retype their Soulseek username/password.
///   2. **Defer** to an externally-running slskd if port 5030 is already in use.
///      Wisp falls back to "connect to whatever's there" mode with no spawn.
///   3. **Defer** if the user explicitly turned off `ManageSlskd` in settings.
///   4. Otherwise **spawn** slskd.exe attached to the same KILL_ON_JOB_CLOSE Windows
///      Job Object the dev-mode Vite sidecar uses, so slskd dies whenever Wisp does.
///      stdout/stderr are piped to Serilog with a `[slskd]` prefix.
///
/// On shutdown, the Job Object cleanup handles slskd termination — we don't need
/// an explicit kill in StopAsync.
public sealed class SlskdSidecar(
    SoulseekOptions options,
    WispSettingsStore settings,
    ILogger<SlskdSidecar> log) : IHostedService
{
    private const int SlskdPort = 5030;
    private Process? _process;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            await StartCoreAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            // Sidecar failures should never block Wisp from starting — the user can
            // always run slskd manually and turn off ManageSlskd in settings.
            log.LogError(ex, "slskd sidecar failed to start; Wisp will continue without managing it.");
        }
    }

    private async Task StartCoreAsync(CancellationToken ct)
    {
        if (!OperatingSystem.IsWindows())
        {
            log.LogInformation("slskd sidecar: not on Windows, skipping.");
            return;
        }

        var bundledRoot = LocateBundledSlskdRoot();
        if (bundledRoot is null)
        {
            log.LogInformation("slskd sidecar: no bundled slskd folder found next to Wisp.exe; falling back to user-managed mode.");
            return;
        }

        // Step 1: opportunistic credential migration on first run.
        TryMigrateCredentials(bundledRoot);

        // Step 2: respect the user's manual override (and skip if they haven't supplied creds yet).
        if (!options.ManageSlskd)
        {
            log.LogInformation("slskd sidecar: ManageSlskd is off — connecting to whatever the user runs themselves.");
            return;
        }
        if (string.IsNullOrWhiteSpace(options.Username) || string.IsNullOrWhiteSpace(options.Password))
        {
            log.LogWarning("slskd sidecar: no Soulseek username/password in settings — sidecar idle until the user fills them in (Settings → Soulseek).");
            return;
        }

        // Step 3: defer if something is already on the port (almost certainly an
        // externally-launched slskd). Avoids fighting the user's own setup.
        if (await IsPortInUseAsync(SlskdPort, ct))
        {
            log.LogInformation("slskd sidecar: port {Port} already in use, assuming an external slskd is running and standing down.", SlskdPort);
            return;
        }

        // Step 4: write a fresh slskd.yml from current Wisp settings and launch.
        var apiKey = !string.IsNullOrWhiteSpace(options.ApiKey)
            ? options.ApiKey!
            : Guid.NewGuid().ToString("N");

        var downloads = !string.IsNullOrWhiteSpace(options.DownloadFolder)
            ? options.DownloadFolder!
            : Path.Combine(WispPaths.SlskdDir, "downloads");
        var incomplete = Path.Combine(WispPaths.SlskdDir, "incomplete");
        Directory.CreateDirectory(downloads);
        Directory.CreateDirectory(incomplete);

        var yaml = SlskdConfig.GenerateSlskdYaml(
            apiKey, options.Username!, options.Password!, SlskdPort, downloads, incomplete);
        File.WriteAllText(WispPaths.SlskdConfigPath, yaml);

        // Push the URL + API key back into Wisp settings so the SoulseekClient picks them up
        // automatically and the user doesn't see "not configured" errors after migration.
        WriteBackUrlAndApiKey($"http://127.0.0.1:{SlskdPort}", apiKey);

        var slskdExe = Path.Combine(bundledRoot, "slskd.exe");
        if (!File.Exists(slskdExe))
        {
            log.LogWarning("slskd sidecar: slskd.exe not found at {Path}; skipping spawn.", slskdExe);
            return;
        }

        var psi = new ProcessStartInfo
        {
            FileName = slskdExe,
            // --no-logo to keep startup chatty, --config so slskd uses the file we just wrote.
            // --app-dir keeps slskd's runtime data (db, downloads index) out of %LOCALAPPDATA%\slskd
            // and inside Wisp's own data folder, so removing/reinstalling Wisp leaves no residue.
            ArgumentList = { "--config", WispPaths.SlskdConfigPath, "--app-dir", WispPaths.SlskdDir },
            WorkingDirectory = bundledRoot,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        proc.OutputDataReceived += (_, e) => { if (e.Data is not null) log.LogInformation("[slskd] {Line}", e.Data); };
        proc.ErrorDataReceived += (_, e) => { if (e.Data is not null) log.LogWarning("[slskd] {Line}", e.Data); };
        proc.Exited += (_, _) => log.LogInformation("[slskd] process exited (code {Code})", proc.HasExited ? proc.ExitCode : -1);

        proc.Start();
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();

        // Tie the child to Wisp's process tree — Job Object guarantees slskd dies even
        // if Wisp crashes hard. Same plumbing we use for the dev-mode Vite sidecar.
        WindowsJobObject.Assign(proc);

        _process = proc;
        log.LogInformation("slskd sidecar: spawned (pid {Pid}) at {Url}", proc.Id, $"http://127.0.0.1:{SlskdPort}");
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        // KILL_ON_JOB_CLOSE handles termination once Wisp's process exits. We don't
        // call Process.Kill here because slskd needs ~1s to flush its db; letting the
        // job kill it on full process exit is cleaner than racing a graceful shutdown.
        return Task.CompletedTask;
    }

    private void TryMigrateCredentials(string bundledRoot)
    {
        // If the user already entered creds in Wisp's settings, don't overwrite them.
        var existing = settings.Current.Catalog?.Soulseek;
        if (existing is not null
            && !string.IsNullOrWhiteSpace(existing.Username)
            && !string.IsNullOrWhiteSpace(existing.Password))
        {
            return;
        }

        var migrated = SlskdConfig.TryMigrate(SlskdConfig.CandidateConfigPaths(bundledRoot));
        if (migrated is null)
        {
            log.LogInformation("slskd sidecar: no existing slskd config to migrate from.");
            return;
        }

        log.LogInformation("slskd sidecar: migrated credentials from existing slskd.yml (username + password{Maybe})",
            migrated.ApiKey is not null ? " + api key" : "");

        SoulseekCredentials? next = null;
        settings.Update(s =>
        {
            var existingSk = s.Catalog?.Soulseek;
            next = new SoulseekCredentials(
                Url: existingSk?.Url ?? $"http://127.0.0.1:{SlskdPort}",
                ApiKey: existingSk?.ApiKey ?? migrated.ApiKey ?? "",
                DownloadFolder: existingSk?.DownloadFolder,
                Username: existingSk?.Username ?? migrated.Username,
                Password: existingSk?.Password ?? migrated.Password,
                ManageSlskd: existingSk?.ManageSlskd ?? true);
            var nextCatalog = (s.Catalog ?? new CatalogCredentials()) with { Soulseek = next };
            return s with { Catalog = nextCatalog };
        });

        // Refresh the in-memory options so the rest of this StartAsync call sees the new values.
        if (next is not null)
        {
            options.Url = next.Url;
            options.ApiKey = next.ApiKey;
            options.Username = next.Username;
            options.Password = next.Password;
        }
    }

    private void WriteBackUrlAndApiKey(string url, string apiKey)
    {
        var existingSk = settings.Current.Catalog?.Soulseek;
        if (existingSk is not null && existingSk.Url == url && existingSk.ApiKey == apiKey) return;

        settings.Update(s =>
        {
            var sk = s.Catalog?.Soulseek;
            var nextSk = (sk ?? new SoulseekCredentials(url, apiKey)) with { Url = url, ApiKey = apiKey };
            var nextCatalog = (s.Catalog ?? new CatalogCredentials()) with { Soulseek = nextSk };
            return s with { Catalog = nextCatalog };
        });
        options.Url = url;
        options.ApiKey = apiKey;
    }

    private static string? LocateBundledSlskdRoot()
    {
        // MSBuild copies slskd-0.25.1-win-x64/** into bin/.../slskd/ at build + publish time.
        var here = Path.Combine(AppContext.BaseDirectory, "slskd");
        return Directory.Exists(here) && File.Exists(Path.Combine(here, "slskd.exe")) ? here : null;
    }

    private static async Task<bool> IsPortInUseAsync(int port, CancellationToken ct)
    {
        // Try to actively connect to the port — a successful connect is the only reliable
        // signal that "something HTTP-like is already there". TcpListener.Bind would also
        // work but binding+unbinding is racier when the OS is recycling sockets.
        try
        {
            using var client = new TcpClient();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromMilliseconds(500));
            await client.ConnectAsync("127.0.0.1", port, timeout.Token);
            return client.Connected;
        }
        catch
        {
            return false;
        }
    }
}
