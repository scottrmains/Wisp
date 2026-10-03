using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Wisp.Cloud.Persistence;

namespace Wisp.Cloud.Api;

public static class CloudAuthentication
{
    public static void AddCloudAuthentication(this IServiceCollection services, CloudConfiguration config)
    {
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
        {
            options.MapInboundClaims = false; options.RequireHttpsMetadata = true; options.IncludeErrorDetails = false;
            options.SaveToken = false; options.BackchannelTimeout = TimeSpan.FromSeconds(10);
            if (config.Enabled) options.Authority = config.Authority;
            options.TokenValidationParameters = new()
            {
                ValidateIssuer = true,
                ValidIssuer = config.Issuer,
                ValidateAudience = true,
                ValidAudience = config.ApiAudience.ToString("D"),
                ValidateLifetime = true,
                RequireExpirationTime = true,
                RequireSignedTokens = true,
                ValidateIssuerSigningKey = true,
                ClockSkew = TimeSpan.FromSeconds(30),
                IssuerValidator = (issuer, _, _) => issuer == config.Issuer ? issuer
                    : throw new SecurityTokenInvalidIssuerException("Unexpected issuer."),
                ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
            };
            options.Events = new()
            {
                OnMessageReceived = context =>
                {
                    if (!config.Enabled) context.NoResult();
                    return Task.CompletedTask;
                },
                OnTokenValidated = context =>
                {
                    if (!TryIdentity(context.Principal!, config, out _)) context.Fail("Invalid account token.");
                    return Task.CompletedTask;
                },
            };
        });
        services.AddAuthorization(options => options.AddPolicy("account", policy => policy
            .RequireAuthenticatedUser().RequireAssertion(context => config.Enabled
                && context.User.FindAll("scp").Count() == 1
                && context.User.FindFirst("scp")!.Value.Split(' ', StringSplitOptions.RemoveEmptyEntries).Contains(config.RequiredScope))));
    }
    public static bool TryIdentity(ClaimsPrincipal user, CloudConfiguration config, out ValidatedIdentity identity)
    {
        identity = null!;
        if (user.FindAll("tid").Count() != 1 || user.FindAll("oid").Count() != 1
            || user.FindAll("azp").Count() != 1 || user.FindAll("ver").Count() != 1
            || user.FindFirst("ver")!.Value != "2.0"
            || !Guid.TryParse(user.FindFirst("tid")!.Value, out var tenant) || tenant != config.TenantId
            || !Guid.TryParse(user.FindFirst("oid")!.Value, out var subject) || subject == Guid.Empty
            || !Guid.TryParse(user.FindFirst("azp")!.Value, out var client) || !config.AllowedClientIds.Contains(client)) return false;
        identity = new(config.Issuer, tenant, subject);
        return true;
    }
}
