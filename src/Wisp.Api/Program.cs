using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Serilog;
using Wisp.Api.ArtistRefresh;
using Wisp.Api.Cleanup;
using Wisp.Api.Cues;
using Wisp.Api.Discovery;
using Wisp.Api.Feedback;
using Wisp.Api.Library;
using Wisp.Api.Tagging;
using Wisp.Api.MixPlans;
using Wisp.Api.Settings;
using Wisp.Api.Soulseek;
using Wisp.Infrastructure;
using Wisp.Infrastructure.ExternalCatalog.Discogs;
using Wisp.Infrastructure.ExternalCatalog.Soulseek;
using Wisp.Infrastructure.ExternalCatalog.Spotify;
using Wisp.Infrastructure.ExternalCatalog.YouTube;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api;

public class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        WispPaths.EnsureCreated();

        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Information()
            .Enrich.FromLogContext()
            .WriteTo.Console()
            .WriteTo.File(
                Path.Combine(WispPaths.LogsDir, "wisp-.log"),
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: 14)
            .CreateBootstrapLogger();

        try
        {
            // Anchor ContentRoot to the exe directory so wwwroot/ resolves correctly when
            // the exe is launched from a different cwd (Start menu, shortcut, double-click).
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                Args = args,
                ContentRootPath = AppContext.BaseDirectory,
            });

            builder.Host.UseSerilog((ctx, services, cfg) => cfg
                .ReadFrom.Configuration(ctx.Configuration)
                .Enrich.FromLogContext()
                .WriteTo.Console()
                .WriteTo.File(
                    Path.Combine(WispPaths.LogsDir, "wisp-.log"),
                    rollingInterval: RollingInterval.Day,
                    retainedFileCountLimit: 14));

            builder.Services.AddOpenApi();
            builder.Services.ConfigureHttpJsonOptions(opts =>
            {
                opts.SerializerOptions.Converters.Add(
                    new System.Text.Json.Serialization.JsonStringEnumConverter());
            });

            builder.Services.AddDbContext<WispDbContext>(opts =>
                opts.UseSqlite(WispPaths.DatabaseConnectionString));

            builder.Services.AddSingleton<WispSettingsStore>();
            builder.Services.AddWispLibrary();

            if (builder.Environment.IsDevelopment())
            {
                builder.Services.AddCors(options =>
                {
                    options.AddDefaultPolicy(policy => policy
                        .WithOrigins("http://localhost:5173", "http://127.0.0.1:5173")
                        .AllowAnyHeader()
                        .AllowAnyMethod());
                });
            }

            var app = builder.Build();

            // Migrations: synchronous because Main is synchronous (so STA stays on the main thread for Photino).
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
                db.Database.Migrate();
            }

            // Wire saved catalog credentials (if any) into the matching options instances.
            var settingsStore = app.Services.GetRequiredService<WispSettingsStore>();
            ApplyCatalogCredentials(
                settingsStore,
                app.Services.GetRequiredService<SpotifyOptions>(),
                app.Services.GetRequiredService<DiscogsOptions>(),
                app.Services.GetRequiredService<YouTubeOptions>(),
                app.Services.GetRequiredService<SoulseekOptions>());

            if (app.Environment.IsDevelopment())
            {
                app.MapOpenApi();
                app.UseCors();
            }

            app.UseDefaultFiles();
            app.UseStaticFiles();

            app.MapGet("/api/health", () => Results.Ok(new
            {
                status = "ok",
                version = typeof(Program).Assembly.GetName().Version?.ToString() ?? "0.0.0",
                time = DateTimeOffset.UtcNow
            }));

            app.MapGet("/api/system", () => Results.Ok(new
            {
                version = typeof(Program).Assembly.GetName().Version?.ToString() ?? "0.0.0",
                appDataDir = WispPaths.AppDataDir,
                databasePath = WispPaths.DatabasePath,
                logsDir = WispPaths.LogsDir,
                configPath = WispPaths.ConfigPath,
                environment = app.Environment.EnvironmentName,
            }));

            app.MapLibrary();
            app.MapMixPlans();
            app.MapCues();
            app.MapCleanup();
            app.MapArtistRefresh();
            app.MapDiscovery();
            app.MapSoulseek();
            app.MapBlendRatings();
            app.MapTags();

            // Helper: apply credentials after every save/delete so the catalog clients pick up changes.
            void ReapplyCatalog() => ApplyCatalogCredentials(
                settingsStore,
                app.Services.GetRequiredService<SpotifyOptions>(),
                app.Services.GetRequiredService<DiscogsOptions>(),
                app.Services.GetRequiredService<YouTubeOptions>(),
                app.Services.GetRequiredService<SoulseekOptions>());

            // ─── Spotify ─────────────────────────────────────────────────────
            app.MapGet("/api/settings/spotify", (WispSettingsStore store) =>
            {
                var creds = store.Current.Catalog?.Spotify;
                return Results.Ok(new
                {
                    isConfigured = !string.IsNullOrWhiteSpace(creds?.ClientId)
                                   && !string.IsNullOrWhiteSpace(creds?.ClientSecret),
                    clientIdPreview = creds?.ClientId is { Length: > 6 } id ? id[..6] + "…" : null,
                });
            });

            app.MapPost("/api/settings/spotify", (SpotifyCredentials? creds, WispSettingsStore store) =>
            {
                if (creds is null
                    || string.IsNullOrWhiteSpace(creds.ClientId)
                    || string.IsNullOrWhiteSpace(creds.ClientSecret))
                {
                    return Results.BadRequest(new { code = "credentials_required",
                        message = "ClientId and ClientSecret are required." });
                }
                store.Update(s => s with
                {
                    Catalog = (s.Catalog ?? new CatalogCredentials()) with { Spotify = creds }
                });
                ReapplyCatalog();
                return Results.NoContent();
            });

            app.MapDelete("/api/settings/spotify", (WispSettingsStore store) =>
            {
                store.Update(s => s with
                {
                    Catalog = (s.Catalog ?? new CatalogCredentials()) with { Spotify = null }
                });
                ReapplyCatalog();
                return Results.NoContent();
            });

            // ─── Discogs ─────────────────────────────────────────────────────
            app.MapGet("/api/settings/discogs", (WispSettingsStore store) =>
            {
                var creds = store.Current.Catalog?.Discogs;
                return Results.Ok(new
                {
                    isConfigured = !string.IsNullOrWhiteSpace(creds?.PersonalAccessToken),
                    tokenPreview = creds?.PersonalAccessToken is { Length: > 6 } t ? t[..6] + "…" : null,
                });
            });

            app.MapPost("/api/settings/discogs", (DiscogsCredentials? creds, WispSettingsStore store) =>
            {
                if (creds is null || string.IsNullOrWhiteSpace(creds.PersonalAccessToken))
                    return Results.BadRequest(new { code = "credentials_required", message = "PersonalAccessToken is required." });
                store.Update(s => s with
                {
                    Catalog = (s.Catalog ?? new CatalogCredentials()) with { Discogs = creds }
                });
                ReapplyCatalog();
                return Results.NoContent();
            });

            app.MapDelete("/api/settings/discogs", (WispSettingsStore store) =>
            {
                store.Update(s => s with
                {
                    Catalog = (s.Catalog ?? new CatalogCredentials()) with { Discogs = null }
                });
                ReapplyCatalog();
                return Results.NoContent();
            });

            // ─── YouTube ─────────────────────────────────────────────────────
            app.MapGet("/api/settings/youtube", (WispSettingsStore store) =>
            {
                var creds = store.Current.Catalog?.YouTube;
                return Results.Ok(new
                {
                    isConfigured = !string.IsNullOrWhiteSpace(creds?.ApiKey),
                    keyPreview = creds?.ApiKey is { Length: > 6 } k ? k[..6] + "…" : null,
                });
            });

            app.MapPost("/api/settings/youtube", (YouTubeCredentials? creds, WispSettingsStore store) =>
            {
                if (creds is null || string.IsNullOrWhiteSpace(creds.ApiKey))
                    return Results.BadRequest(new { code = "credentials_required", message = "ApiKey is required." });
                store.Update(s => s with
                {
                    Catalog = (s.Catalog ?? new CatalogCredentials()) with { YouTube = creds }
                });
                ReapplyCatalog();
                return Results.NoContent();
            });

            app.MapDelete("/api/settings/youtube", (WispSettingsStore store) =>
            {
                store.Update(s => s with
                {
                    Catalog = (s.Catalog ?? new CatalogCredentials()) with { YouTube = null }
                });
                ReapplyCatalog();
                return Results.NoContent();
            });

            // ─── Soulseek (slskd) ────────────────────────────────────────────
            app.MapGet("/api/settings/soulseek", (WispSettingsStore store) =>
            {
                var creds = store.Current.Catalog?.Soulseek;
                return Results.Ok(new
                {
                    isConfigured = !string.IsNullOrWhiteSpace(creds?.Url) && !string.IsNullOrWhiteSpace(creds?.ApiKey),
                    url = creds?.Url,
                    keyPreview = creds?.ApiKey is { Length: > 6 } k ? k[..6] + "…" : null,
                    downloadFolder = creds?.DownloadFolder,
                });
            });

            app.MapPost("/api/settings/soulseek", (SoulseekCredentials? creds, WispSettingsStore store) =>
            {
                if (creds is null
                    || string.IsNullOrWhiteSpace(creds.Url)
                    || string.IsNullOrWhiteSpace(creds.ApiKey))
                {
                    return Results.BadRequest(new { code = "credentials_required",
                        message = "Url and ApiKey are required." });
                }
                store.Update(s => s with
                {
                    Catalog = (s.Catalog ?? new CatalogCredentials()) with { Soulseek = creds }
                });
                ReapplyCatalog();
                return Results.NoContent();
            });

            app.MapDelete("/api/settings/soulseek", (WispSettingsStore store) =>
            {
                store.Update(s => s with
                {
                    Catalog = (s.Catalog ?? new CatalogCredentials()) with { Soulseek = null }
                });
                ReapplyCatalog();
                return Results.NoContent();
            });

            app.MapFallbackToFile("index.html");

            var photinoEnabled = app.Configuration.GetValue("Wisp:LaunchPhotino", !app.Environment.IsDevelopment());

            if (!photinoEnabled)
            {
                app.Run();
                return 0;
            }

            // Photino + WebView2 require the main thread to remain STA. `await` in a console
            // app resumes on a thread-pool (MTA) thread, which silently breaks WebView2 paint.
            // Fire-and-forget the host, then keep this thread parked in PhotinoWindow.WaitForClose().
            var hostTask = app.RunAsync();

            try
            {
                var lifetime = app.Services.GetRequiredService<IHostApplicationLifetime>();
                lifetime.ApplicationStarted.WaitHandle.WaitOne();

                SpaSidecar? spa = null;
                var spaCommand = app.Configuration["Wisp:SpaCommand"];
                var spaUrl = app.Configuration["Wisp:SpaUrl"];

                if (!string.IsNullOrWhiteSpace(spaCommand) && !string.IsNullOrWhiteSpace(spaUrl))
                {
                    var spaCwd = Path.GetFullPath(
                        app.Configuration["Wisp:SpaWorkingDirectory"]
                            ?? Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "Wisp.Client"));
                    spa = SpaSidecar.StartAsync(spaCommand, spaCwd, spaUrl, TimeSpan.FromSeconds(60))
                        .GetAwaiter()
                        .GetResult();
                }

                var rawUrl = spaUrl
                             ?? app.Urls.FirstOrDefault(u => u.StartsWith("http://"))
                             ?? "http://127.0.0.1:5125";

                // WebView2 prefers loopback IP over the `localhost` hostname.
                var url = rawUrl.Replace("://localhost", "://127.0.0.1");

                Log.Information("Launching Photino window at {Url}", url);

                try
                {
                    PhotinoHost.Run(
                        url,
                        app.Services.GetRequiredService<WispSettingsStore>(),
                        devToolsEnabled: app.Environment.IsDevelopment());
                }
                finally
                {
                    spa?.DisposeAsync().AsTask().GetAwaiter().GetResult();
                }
            }
            finally
            {
                app.StopAsync().GetAwaiter().GetResult();
                hostTask.GetAwaiter().GetResult();
            }

            return 0;
        }
        catch (Exception ex)
        {
            Log.Fatal(ex, "Wisp host terminated unexpectedly");
            return 1;
        }
        finally
        {
            Log.CloseAndFlush();
        }
    }

    public static void ApplyCatalogCredentials(
        WispSettingsStore store,
        SpotifyOptions spotify,
        DiscogsOptions discogs,
        YouTubeOptions youTube,
        SoulseekOptions soulseek)
    {
        var catalog = store.Current.Catalog;

        spotify.ClientId = catalog?.Spotify?.ClientId;
        spotify.ClientSecret = catalog?.Spotify?.ClientSecret;

        discogs.PersonalAccessToken = catalog?.Discogs?.PersonalAccessToken;

        youTube.ApiKey = catalog?.YouTube?.ApiKey;

        soulseek.Url = catalog?.Soulseek?.Url;
        soulseek.ApiKey = catalog?.Soulseek?.ApiKey;
        soulseek.DownloadFolder = catalog?.Soulseek?.DownloadFolder;
    }
}
