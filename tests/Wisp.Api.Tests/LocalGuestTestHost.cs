using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Wisp.Api.Accounts;

namespace Wisp.Api.Tests;

internal static class LocalGuestTestHost
{
    public static void UseLocalGuestGroundwork(this WebApplication app)
    {
        app.UseDesktopRequestProtection(new(["http://localhost"]));
        app.MapWispAccountGroundwork();
    }
    public static HttpClient GetLocalTestClient(this WebApplication app)
    {
        var client = app.GetTestClient();
        client.DefaultRequestHeaders.Add(DesktopRequestSecurity.CommandHeader, DesktopRequestSecurity.CommandHeaderValue);
        return client;
    }
}
