using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Wisp.Api.Accounts;
using Wisp.Core.Accounts;

namespace Wisp.Api.Tests;

public sealed class AccountGroundworkTests
{
    [Theory]
    [InlineData(null, "Disabled")]
    [InlineData("false", "Disabled")]
    [InlineData("invalid", "Disabled")]
    [InlineData("true", "NotImplemented")]
    public async Task Local_status_is_guest_without_network_disk_or_provider_side_effects(string? enabled, string expected)
    {
        var root = Path.Combine(Path.GetTempPath(), "wisp-account-api-" + Guid.NewGuid().ToString("N"));
        var builder = WebApplication.CreateBuilder(); builder.WebHost.UseTestServer();
        builder.Configuration["Wisp:Cloud:Enabled"] = enabled;
        builder.Configuration["Wisp:Cloud:ApiBaseUrl"] = "https://unreachable.example.test";
        builder.Configuration["Wisp:Cloud:Authority"] = "https://unreachable-login.example.test";
        builder.Configuration["Wisp:Cloud:ClientId"] = "public-client";
        builder.Services.AddWispAccountGroundwork(builder.Configuration, root);
        await using var app = builder.Build(); app.UseDesktopRequestProtection(new(["http://localhost"]));
        app.MapWispAccountGroundwork(); await app.StartAsync();
        using var client = app.GetTestClient();
        var response = await client.GetAsync("/api/account/status"); response.EnsureSuccessStatusCode();
        var status = (await response.Content.ReadFromJsonAsync<AccountStatusDto>())!;
        Assert.Equal(1, status.ContractVersion); Assert.Equal("Guest", status.State); Assert.Equal("Guest", status.DisplayName);
        Assert.Equal(expected, status.CloudState); Assert.Null(status.User); Assert.False(status.CanSignIn); Assert.False(status.CloudAvailable);
        Assert.Contains("Playback", status.LocalCapabilities); Assert.Contains("Recording", status.LocalCapabilities);
        Assert.Contains("CdjExport", status.LocalCapabilities); Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        Assert.False(app.Services.GetRequiredService<IProtectedAccountTokenStore>().IsAvailable);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("unreachable", body); Assert.DoesNotContain("public-client", body); Assert.DoesNotContain(root, body);
        Assert.False(Directory.Exists(root)); // status does not create an installation ID/cache/profile
        var endpoints = app.Services.GetRequiredService<Microsoft.AspNetCore.Routing.EndpointDataSource>().Endpoints;
        Assert.DoesNotContain(endpoints, e => e.DisplayName?.Contains("token", StringComparison.OrdinalIgnoreCase) == true);
    }
}
