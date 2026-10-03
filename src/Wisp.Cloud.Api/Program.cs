using System.Threading.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Wisp.Cloud.Persistence;

namespace Wisp.Cloud.Api;

public class Program
{
    public static WebApplication Build(string[] args, Action<WebApplicationBuilder>? testSetup = null)
    {
        var builder = WebApplication.CreateBuilder(args);
        testSetup?.Invoke(builder);
        var config = builder.Configuration.GetSection("Cloud").Get<CloudConfiguration>() ?? new();
        config.Validate(builder.Environment.IsDevelopment());
        builder.Services.AddSingleton(config);
        builder.Services.AddCloudAuthentication(config);
        if (config.Enabled)
        {
            builder.Services.AddDbContext<CloudDbContext>(o => o.UseNpgsql(config.ConnectionString).EnableDetailedErrors(false));
            builder.Services.AddScoped<AccountRepository>();
        }
        builder.WebHost.ConfigureKestrel(o => { o.Limits.MaxRequestBodySize = 16_384; o.Limits.MaxConcurrentConnections = 100; o.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(10); });
        // No request/EF/auth-framework logs containing claims, SQL parameters,
        // query strings, connection strings or authentication failure details.
        builder.Logging.ClearProviders(); builder.Logging.AddJsonConsole();
        builder.Logging.AddFilter("Microsoft", LogLevel.None);
        builder.Logging.AddFilter("Npgsql", LogLevel.None);
        builder.Services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = 429;
            o.OnRejected = (context, _) => { context.HttpContext.Response.Headers.RetryAfter = "60"; return ValueTask.CompletedTask; };
            // Fixed global partitions bound limiter memory; caps apply per replica.
            o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
                RateLimitPartition.GetFixedWindowLimiter(context.Request.Path.StartsWithSegments("/health") ? "health" : "api",
                    _ => new() { PermitLimit = 120, Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true }));
        });
        var app = builder.Build();
        app.Use(async (context, next) =>
        {
            var requestId = Guid.NewGuid().ToString("N");
            context.Response.Headers["X-Request-Id"] = requestId;
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
            timeout.CancelAfter(TimeSpan.FromSeconds(20));
            context.RequestAborted = timeout.Token;
            try { await next(context); }
            catch (AccountNotActiveException) { context.Response.StatusCode = 403; await context.Response.WriteAsJsonAsync(new { code = "account_unavailable" }); }
            catch (OperationCanceledException) { if (!context.Response.HasStarted) context.Response.StatusCode = 504; }
            catch (Exception)
            {
                if (!context.Response.HasStarted) { context.Response.StatusCode = 503; await context.Response.WriteAsJsonAsync(new { code = "service_unavailable" }); }
                // Deliberately do not log the exception message or identity.
                app.Logger.LogError("Cloud operation failed; request {RequestId}", requestId);
            }
            finally { app.Logger.LogInformation("Cloud request {RequestId} returned {StatusCode}", requestId, context.Response.StatusCode); }
        });
        app.UseRateLimiter(); app.UseAuthentication(); app.UseAuthorization();
        app.MapGet("/health/live", () => Results.Ok(new { status = "live" })).AllowAnonymous();
        app.MapGet("/health/ready", async (IServiceProvider services, CancellationToken ct) =>
        {
            if (!config.Enabled) return Results.StatusCode(503);
            var db = services.GetRequiredService<CloudDbContext>();
            // Readiness requires the reviewed migration, not just an open port.
            await db.Users.AsNoTracking().Select(u => u.Id).Take(1).ToArrayAsync(ct);
            return Results.Ok(new { status = "ready" });
        }).AllowAnonymous();
        var accounts = app.MapGroup("/api/v1/account").RequireAuthorization("account");
        accounts.MapGet("/me", async (HttpContext context, IServiceProvider services, CancellationToken ct) =>
        {
            CloudAuthentication.TryIdentity(context.User, config, out var identity);
            var result = await services.GetRequiredService<AccountRepository>().ReadAsync(identity, ct);
            return result is null ? Results.NotFound(new { code = "account_not_provisioned" }) : Results.Ok(result);
        });
        accounts.MapPost("/provision", async (HttpContext context, IServiceProvider services, CancellationToken ct) =>
        {
            if (context.Request.ContentLength is > 0 || context.Request.Headers.ContainsKey("Transfer-Encoding"))
                return Results.BadRequest(new { code = "provision_does_not_accept_profile_data" });
            CloudAuthentication.TryIdentity(context.User, config, out var identity);
            return Results.Ok(await services.GetRequiredService<AccountRepository>().ProvisionAsync(identity, ct));
        });
        return app;
    }
    public static async Task Main(string[] args)
    {
        await using var app = Build(args);
        // Migrations run explicitly using a separately authorized deployment role,
        // never on startup under the restricted runtime database identity.
        await app.RunAsync();
    }
}
