using Wisp.Core.Accounts;
using Wisp.Infrastructure;
using Wisp.Infrastructure.Accounts;

namespace Wisp.Api.Accounts;

public static class AccountEndpoints
{
    public static void AddWispAccountGroundwork(this IServiceCollection services, IConfiguration configuration, string? profileDirectory = null)
    {
        var cloud = configuration.GetSection("Wisp:Cloud");
        var enabled = bool.TryParse(cloud["Enabled"], out var requested) && requested;
        services.AddSingleton(new CloudAccountConfiguration(enabled, cloud["ApiBaseUrl"], cloud["Authority"], cloud["ClientId"]));
        services.AddSingleton<IAccountSessionService, GuestAccountSessionService>();
        services.AddSingleton<ICloudAccountClient, NoCloudAccountClient>();
        services.AddSingleton<IEntitlementService, GuestEntitlementService>();
        services.AddSingleton<IProtectedAccountTokenStore, UnavailableAccountTokenStore>();
        services.AddSingleton<IInstallationIdentityStore>(_ => new InstallationIdentityStore(
            Path.Combine(profileDirectory ?? WispPaths.AppDataDir, "account-installation.id")));
    }
    public static void MapWispAccountGroundwork(this WebApplication app)
    {
        // Read-only status; no login, token access, binding writes or premium routes.
        app.MapGet("/api/account/status", async (HttpContext context, IAccountSessionService accounts,
            IEntitlementService entitlements, CancellationToken ct) =>
        {
            var session = await accounts.GetSessionAsync(ct);
            var capabilities = await entitlements.GetCapabilitiesAsync(ct);
            context.Response.Headers.CacheControl = "no-store";
            return Results.Ok(new AccountStatusDto(1, session.State.ToString(), session.User?.DisplayName ?? "Guest",
                false, capabilities.CloudAvailable, session.Cloud.ToString(),
                capabilities.Local.Select(c => c.ToString()).ToArray(), session.User));
        });
    }
}
public sealed record AccountStatusDto(int ContractVersion, string State, string DisplayName, bool CanSignIn,
    bool CloudAvailable, string CloudState, string[] LocalCapabilities, AccountProfile? User);
