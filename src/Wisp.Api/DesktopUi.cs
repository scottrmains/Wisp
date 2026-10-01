using System.Reflection;
using Microsoft.AspNetCore.WebUtilities;

namespace Wisp.Api;

/// Keep the desktop entry document fresh without clearing origin storage or
/// changing the loopback port (both would lose the user's UI preferences/drafts).
public static class DesktopUi
{
    public static string Version { get; } = typeof(Program).Assembly
        .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
        ?? typeof(Program).Assembly.GetName().Version?.ToString() ?? "unknown";

    public static string LaunchUrl(string url, string? version = null)
    {
        var uri = new UriBuilder(url);
        var query = QueryHelpers.ParseQuery(uri.Query);
        query["wisp-ui"] = version ?? Version;
        uri.Query = QueryString.Create(query).Value;
        return uri.Uri.AbsoluteUri;
    }

    public static void UseDesktopUiCachePolicy(this WebApplication app)
    {
        app.Use((context, next) =>
        {
            var path = context.Request.Path;
            // Static-file 304 responses may omit Content-Type. Remember shell
            // requests before UseDefaultFiles rewrites '/' to '/index.html'.
            var shellRequest = !path.StartsWithSegments("/api") &&
                (!Path.HasExtension(path.Value) || path.Value!.EndsWith("/index.html", StringComparison.OrdinalIgnoreCase));
            context.Response.OnStarting(() =>
            {
                if (context.Response.ContentType?.StartsWith("text/html", StringComparison.OrdinalIgnoreCase) == true ||
                    (shellRequest && context.Response.StatusCode is 200 or 304))
                {
                    context.Response.Headers.CacheControl = "no-store, max-age=0";
                    context.Response.Headers.Pragma = "no-cache";
                    context.Response.Headers.Expires = "0";
                }
                return Task.CompletedTask;
            });
            return next(context);
        });
    }
}
