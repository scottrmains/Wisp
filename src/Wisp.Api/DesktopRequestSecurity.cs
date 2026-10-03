using System.Net;

namespace Wisp.Api;

/// Browser-origin/CSRF protection, not authentication against local processes.
public sealed class DesktopRequestSecurity
{
    public const string CommandHeader = "X-Wisp-Client";
    public const string CommandHeaderValue = "desktop-v1";
    private readonly HashSet<string> origins = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<int> hostPorts = [];

    public DesktopRequestSecurity(IEnumerable<string> addresses, bool development = false, string? spaUrl = null)
    {
        foreach (var address in addresses)
        {
            var uri = ParseLoopbackUrl(address);
            hostPorts.Add(uri.Port);
            AddOrigins(uri);
        }
        if (hostPorts.Count == 0) throw new InvalidOperationException("A loopback address is required.");
        if (development)
        {
            AddOrigins(new Uri("http://localhost:5173"));
            if (!string.IsNullOrWhiteSpace(spaUrl)) AddOrigins(ParseLoopbackUrl(spaUrl));
        }
    }
    public static DesktopRequestSecurity ConfigureLoopbackHost(WebApplicationBuilder builder)
    {
        // Explicit Kestrel endpoints override UseUrls; reject that bypass. The
        // desktop's file/USB API must never become a remotely bound cloud host.
        if (builder.Configuration.GetSection("Kestrel:Endpoints").GetChildren().Any())
            throw new InvalidOperationException("The desktop host uses loopback URLs, not Kestrel endpoint configuration.");
        var addresses = (builder.Configuration["urls"] ?? "http://127.0.0.1:5125")
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var spaUrl = builder.Configuration["Wisp:SpaUrl"];
        if (!string.IsNullOrWhiteSpace(spaUrl)) ParseLoopbackUrl(spaUrl);
        var policy = new DesktopRequestSecurity(addresses, builder.Environment.IsDevelopment(), spaUrl);
        builder.WebHost.UseUrls(addresses);
        return policy;
    }
    public string? Rejection(HttpContext context)
    {
        var request = context.Request;
        if (!IsLoopbackHost(request.Host.Host) || !hostPorts.Contains(request.Host.Port ?? (request.IsHttps ? 443 : 80))
            || (context.Connection.RemoteIpAddress is { } remote && !IPAddress.IsLoopback(remote)))
            return "local_host_required";
        var origin = request.Headers.Origin;
        if (origin.Count != 0)
        {
            if (origin.Count != 1 || !IsTrustedOrigin(origin[0])) return "untrusted_origin";
        }
        else
        {
            // WebView/media requests can omit Origin. Fetch metadata and Referer
            // still reject requests initiated by a different website.
            var site = request.Headers["Sec-Fetch-Site"];
            if (site.Count > 1 || (site.Count == 1 && site[0] is not ("same-origin" or "none")))
                return "untrusted_origin";
            var referer = request.Headers.Referer;
            if (referer.Count > 1 || (referer.Count == 1 && (!Uri.TryCreate(referer[0], UriKind.Absolute, out var uri)
                || !origins.Contains(uri.GetLeftPart(UriPartial.Authority))))) return "untrusted_origin";
        }
        if (request.Path.StartsWithSegments("/api") && !HttpMethods.IsGet(request.Method)
            && !HttpMethods.IsHead(request.Method) && !HttpMethods.IsOptions(request.Method)
            && (request.Headers[CommandHeader].Count != 1 || request.Headers[CommandHeader][0] != CommandHeaderValue))
            return "local_command_header_required";
        return null;
    }
    private bool IsTrustedOrigin(string? origin) => origin is not null && origins.Contains(origin);
    private void AddOrigins(Uri uri)
    {
        origins.Add(uri.GetLeftPart(UriPartial.Authority));
        foreach (var host in new[] { "localhost", "127.0.0.1", "[::1]" })
            origins.Add($"{uri.Scheme}://{host}" + (uri.IsDefaultPort ? "" : $":{uri.Port}"));
    }
    private static bool IsLoopbackHost(string host) => host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
        || (IPAddress.TryParse(host.Trim('[', ']'), out var address) && IPAddress.IsLoopback(address));
    private static Uri ParseLoopbackUrl(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttp
            || !IsLoopbackHost(uri.Host) || uri.Port == 0 || uri.AbsolutePath != "/"
            || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0)
            throw new InvalidOperationException("WISP desktop URLs must be HTTP loopback addresses with a nonzero port.");
        return uri;
    }
}
public static class DesktopRequestSecurityExtensions
{
    public static void UseDesktopRequestProtection(this WebApplication app, DesktopRequestSecurity policy)
    {
        app.Use(async (context, next) =>
        {
            if (policy.Rejection(context) is { } code)
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                context.Response.Headers.CacheControl = "no-store";
                await context.Response.WriteAsJsonAsync(new { code, message = "This request is not allowed by the local WISP host." }, context.RequestAborted);
                return;
            }
            await next(context);
        });
    }
}
