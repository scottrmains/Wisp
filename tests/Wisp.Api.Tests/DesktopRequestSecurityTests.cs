using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Wisp.Api;

namespace Wisp.Api.Tests;

public sealed class DesktopRequestSecurityTests
{
    private static DefaultHttpContext Request(string method = "GET")
    {
        var context = new DefaultHttpContext(); context.Request.Method = method;
        context.Request.Scheme = "http"; context.Request.Host = new("127.0.0.1", 5125);
        context.Request.Path = "/api/test"; context.Connection.RemoteIpAddress = IPAddress.Loopback;
        return context;
    }
    private static DesktopRequestSecurity Policy(bool development = false) => new(["http://127.0.0.1:5125"], development);

    [Theory]
    [InlineData("http://0.0.0.0:5125")]
    [InlineData("http://*:5125")]
    [InlineData("http://[::]:5125")]
    [InlineData("http://192.168.1.2:5125")]
    [InlineData("http://example.test:5125")]
    [InlineData("http://localhost.evil.test:5125")]
    [InlineData("https://localhost:5125")]
    [InlineData("http://localhost:5125/path")]
    [InlineData("http://user@localhost:5125")]
    [InlineData("http://localhost:0")]
    public void Non_loopback_or_ambiguous_host_configuration_is_rejected(string url)
        => Assert.Throws<InvalidOperationException>(() => new DesktopRequestSecurity([url]));

    [Theory]
    [InlineData("http://localhost:5125")]
    [InlineData("http://127.0.0.1:5125")]
    [InlineData("http://[::1]:5125")]
    public void Trusted_shell_media_and_commands_do_not_need_a_cloud_account(string origin)
    {
        var request = Request("POST"); request.Request.Headers.Origin = origin;
        request.Request.Headers[DesktopRequestSecurity.CommandHeader] = DesktopRequestSecurity.CommandHeaderValue;
        Assert.Null(Policy().Rejection(request));
        request.Request.Method = "GET"; request.Request.Headers.Remove(DesktopRequestSecurity.CommandHeader);
        Assert.Null(Policy().Rejection(request));
    }

    [Theory]
    [InlineData("https://evil.test")]
    [InlineData("null")]
    [InlineData("http://127.0.0.1:9999")]
    [InlineData("http://localhost.evil.test:5125")]
    [InlineData("http://localhost:5125/")]
    public void Foreign_or_opaque_origin_cannot_read_or_command_local_api(string origin)
    {
        var request = Request(); request.Request.Headers.Origin = origin;
        Assert.Equal("untrusted_origin", Policy().Rejection(request));
        request.Request.Method = "POST"; request.Request.Headers[DesktopRequestSecurity.CommandHeader] = DesktopRequestSecurity.CommandHeaderValue;
        Assert.Equal("untrusted_origin", Policy().Rejection(request));
    }

    [Theory]
    [InlineData("POST")][InlineData("PUT")][InlineData("PATCH")][InlineData("DELETE")]
    public void Simple_browser_commands_without_a_marker_are_rejected(string method)
    {
        var request = Request(method); Assert.Equal("local_command_header_required", Policy().Rejection(request));
        request.Request.Headers[DesktopRequestSecurity.CommandHeader] = "wrong";
        Assert.Equal("local_command_header_required", Policy().Rejection(request));
        request.Request.Headers[DesktopRequestSecurity.CommandHeader] = DesktopRequestSecurity.CommandHeaderValue;
        Assert.Null(Policy().Rejection(request));
    }

    [Fact]
    public void Rebinding_remote_connections_and_headerless_browser_attack_paths_are_rejected()
    {
        var request = Request(); request.Request.Host = new("evil.test", 5125);
        Assert.Equal("local_host_required", Policy().Rejection(request));
        request = Request(); request.Request.Host = new("localhost", 9999);
        Assert.Equal("local_host_required", Policy().Rejection(request));
        request = Request(); request.Connection.RemoteIpAddress = IPAddress.Parse("192.168.1.10");
        Assert.Equal("local_host_required", Policy().Rejection(request));
        request = Request(); request.Request.Headers["Sec-Fetch-Site"] = "cross-site";
        Assert.Equal("untrusted_origin", Policy().Rejection(request));
        request = Request(); request.Request.Headers.Referer = "https://evil.test/form";
        Assert.Equal("untrusted_origin", Policy().Rejection(request));
        request.Request.Headers.Referer = "http://localhost:5125/library";
        Assert.Null(Policy().Rejection(request));
        request.Request.Headers.Origin = new[] { "http://localhost:5125", "https://evil.test" };
        Assert.Equal("untrusted_origin", Policy().Rejection(request));
    }

    [Fact]
    public void Vite_is_trusted_only_in_development_and_never_for_an_arbitrary_remote_spa()
    {
        var request = Request("POST"); request.Request.Headers.Origin = "http://localhost:5173";
        request.Request.Headers[DesktopRequestSecurity.CommandHeader] = DesktopRequestSecurity.CommandHeaderValue;
        Assert.Null(Policy(true).Rejection(request)); Assert.Equal("untrusted_origin", Policy().Rejection(request));
        Assert.Throws<InvalidOperationException>(() => new DesktopRequestSecurity(["http://localhost:5125"], true, "https://evil.test"));
    }

    [Fact]
    public void Configuration_defaults_are_loopback_and_explicit_kestrel_binding_cannot_bypass_guard()
    {
        var builder = WebApplication.CreateBuilder(); builder.Configuration["urls"] = null;
        builder.Configuration["Wisp:SpaUrl"] = null;
        Assert.NotNull(DesktopRequestSecurity.ConfigureLoopbackHost(builder));
        Assert.Equal("http://127.0.0.1:5125", builder.Configuration["urls"]);
        builder.Configuration["Kestrel:Endpoints:Public:Url"] = "http://0.0.0.0:5125";
        Assert.Throws<InvalidOperationException>(() => DesktopRequestSecurity.ConfigureLoopbackHost(builder));
    }

    [Fact]
    public async Task Middleware_blocks_before_command_handler_and_preserves_local_requests()
    {
        var builder = WebApplication.CreateBuilder(); builder.WebHost.UseTestServer();
        await using var app = builder.Build(); app.UseDesktopRequestProtection(new(["http://localhost"]));
        var writes = 0; app.MapPost("/api/test", () => { writes++; return Results.NoContent(); });
        await app.StartAsync(); using var client = app.GetTestClient();
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync("/api/test", null)).StatusCode);
        Assert.Equal(0, writes);
        client.DefaultRequestHeaders.Add(DesktopRequestSecurity.CommandHeader, DesktopRequestSecurity.CommandHeaderValue);
        (await client.PostAsync("/api/test", null)).EnsureSuccessStatusCode(); Assert.Equal(1, writes);
        client.DefaultRequestHeaders.Add("Origin", "https://evil.test");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync("/api/test", null)).StatusCode); Assert.Equal(1, writes);
    }
}
