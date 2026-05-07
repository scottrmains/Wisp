using Microsoft.EntityFrameworkCore;
using Serilog;
using Wisp.Api;
using Wisp.Api.Settings;
using Wisp.Infrastructure;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api;

public class Program
{
    [STAThread]
    public static async Task Main(string[] args)
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
            var builder = WebApplication.CreateBuilder(args);

            builder.Host.UseSerilog((ctx, services, cfg) => cfg
                .ReadFrom.Configuration(ctx.Configuration)
                .Enrich.FromLogContext()
                .WriteTo.Console()
                .WriteTo.File(
                    Path.Combine(WispPaths.LogsDir, "wisp-.log"),
                    rollingInterval: RollingInterval.Day,
                    retainedFileCountLimit: 14));

            builder.Services.AddOpenApi();

            builder.Services.AddDbContext<WispDbContext>(opts =>
                opts.UseSqlite(WispPaths.DatabaseConnectionString));

            builder.Services.AddSingleton<WispSettingsStore>();

            if (builder.Environment.IsDevelopment())
            {
                builder.Services.AddCors(options =>
                {
                    options.AddDefaultPolicy(policy => policy
                        .WithOrigins("http://localhost:5173")
                        .AllowAnyHeader()
                        .AllowAnyMethod());
                });
            }

            var app = builder.Build();

            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
                await db.Database.MigrateAsync();
            }

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

            app.MapFallbackToFile("index.html");

            var photinoEnabled = app.Configuration.GetValue("Wisp:LaunchPhotino", !app.Environment.IsDevelopment());

            if (photinoEnabled)
            {
                await app.StartAsync();

                var url = app.Urls.FirstOrDefault(u => u.StartsWith("http://"))
                          ?? app.Urls.FirstOrDefault()
                          ?? "http://localhost:5125";

                Log.Information("Launching Photino window at {Url}", url);

                PhotinoHost.Run(url, app.Services.GetRequiredService<WispSettingsStore>());

                await app.StopAsync();
            }
            else
            {
                await app.RunAsync();
            }
        }
        catch (Exception ex)
        {
            Log.Fatal(ex, "Wisp host terminated unexpectedly");
            throw;
        }
        finally
        {
            await Log.CloseAndFlushAsync();
        }
    }
}
