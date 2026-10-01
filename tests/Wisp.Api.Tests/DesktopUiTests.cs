using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.FileProviders;
using Wisp.Api;

namespace Wisp.Api.Tests;

public sealed class DesktopUiTests
{
    [Fact]
    public async Task Real_default_and_static_files_keep_no_store_on_get_head_and_not_modified()
    {
        var fixtureRoot = Path.Combine(Path.GetTempPath(), "wisp-ui-cache-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(fixtureRoot);
        try
        {
            await File.WriteAllTextAsync(Path.Combine(fixtureRoot, "index.html"), "<html>Current WISP</html>");
            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseTestServer();
            await using var app = builder.Build();
            using var files = new PhysicalFileProvider(fixtureRoot);
            app.UseDesktopUiCachePolicy();
            app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
            app.UseStaticFiles(new StaticFileOptions { FileProvider = files });
            await app.StartAsync();
            using var client = app.GetTestClient();
            using var get = await client.GetAsync("/?wisp-ui=new");
            Assert.Equal(HttpStatusCode.OK, get.StatusCode);
            Assert.True(get.Headers.CacheControl!.NoStore);
            Assert.NotNull(get.Headers.ETag);
            using var head = await client.SendAsync(new HttpRequestMessage(HttpMethod.Head, "/index.html"));
            Assert.Equal(HttpStatusCode.OK, head.StatusCode);
            Assert.True(head.Headers.CacheControl!.NoStore);
            using var conditional = new HttpRequestMessage(HttpMethod.Get, "/");
            conditional.Headers.IfNoneMatch.Add(get.Headers.ETag!);
            using var notModified = await client.SendAsync(conditional);
            Assert.Equal(HttpStatusCode.NotModified, notModified.StatusCode);
            Assert.True(notModified.Headers.CacheControl!.NoStore);
        }
        finally { Directory.Delete(fixtureRoot, recursive: true); } // only this test's UUID fixture
    }

    [Fact]
    public void Upgrade_changes_only_entry_cache_key_not_origin_path_query_or_fragment()
    {
        const string source = "http://127.0.0.1:5000/?mode=review&mode=tracklist&wisp-ui=old#mix";
        var upgraded = new Uri(DesktopUi.LaunchUrl(source, "0.1.112+commit"));
        Assert.Equal("http://127.0.0.1:5000", upgraded.GetLeftPart(UriPartial.Authority));
        Assert.Equal("/", upgraded.AbsolutePath);
        Assert.Equal("#mix", upgraded.Fragment);
        var query = QueryHelpers.ParseQuery(upgraded.Query);
        Assert.Equal(new[] { "review", "tracklist" }, query["mode"].ToArray());
        Assert.Equal("0.1.112+commit", Assert.Single(query["wisp-ui"].ToArray()));
        Assert.NotEqual(DesktopUi.LaunchUrl(source, "0.1.111"), upgraded.AbsoluteUri);
        Assert.Equal(upgraded.AbsoluteUri, DesktopUi.LaunchUrl(upgraded.AbsoluteUri, "0.1.112+commit"));
    }

    [Fact]
    public void Launch_key_comes_from_the_running_assembly_release_identity()
    {
        Assert.NotEmpty(DesktopUi.Version);
        Assert.Equal(DesktopUi.Version, QueryHelpers.ParseQuery(new Uri(DesktopUi.LaunchUrl("http://127.0.0.1:5125/")).Query)["wisp-ui"]);
    }

    [Theory]
    [InlineData("/", false)]
    [InlineData("/?wisp-ui=new", false)]
    [InlineData("/index.html", false)]
    [InlineData("/mixes/review", false)]
    [InlineData("/", true)]
    [InlineData("/index.html", true)]
    public async Task Entry_html_and_conditional_responses_are_never_stored(string path, bool conditional)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        await using var app = builder.Build();
        app.UseDesktopUiCachePolicy();
        app.Run(context =>
        {
            if (conditional) { context.Response.StatusCode = 304; return Task.CompletedTask; }
            context.Response.ContentType = "text/html";
            return context.Response.WriteAsync("<html>Current WISP</html>");
        });
        await app.StartAsync();
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (conditional) request.Headers.IfNoneMatch.ParseAdd("\"old\"");
        using var response = await app.GetTestClient().SendAsync(request);
        Assert.Equal(conditional ? HttpStatusCode.NotModified : HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl!.NoStore);
        Assert.Equal(TimeSpan.Zero, response.Headers.CacheControl.MaxAge);
        Assert.Contains(response.Headers.Pragma, value => value.Name == "no-cache");
    }

    [Theory]
    [InlineData("/api/health", "application/json")]
    [InlineData("/assets/current.js", "text/javascript")]
    [InlineData("/assets/current.css", "text/css")]
    public async Task Asset_and_api_cache_semantics_are_not_rewritten(string path, string contentType)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        await using var app = builder.Build();
        app.UseDesktopUiCachePolicy();
        app.Run(context =>
        {
            context.Response.ContentType = contentType;
            context.Response.Headers.CacheControl = "public, max-age=600";
            return context.Response.WriteAsync("fixture");
        });
        await app.StartAsync();
        using var response = await app.GetTestClient().GetAsync(path);
        Assert.False(response.Headers.CacheControl!.NoStore);
        Assert.Equal(TimeSpan.FromSeconds(600), response.Headers.CacheControl.MaxAge);
    }
}
