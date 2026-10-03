using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Identity.Client;

// Standalone development proof, NOT wired into the desktop app. MSAL handles
// OAuth/PKCE and the loopback callback. No token serialization or PII logging.
try
{
    if (args is not ["--approved-development-proof"])
        throw new InvalidOperationException();
    var authority = new Uri(Environment.GetEnvironmentVariable("WISP_PROOF_AUTHORITY") ?? "");
    var backend = new Uri(Environment.GetEnvironmentVariable("WISP_PROOF_API") ?? "");
    if (!Guid.TryParse(Environment.GetEnvironmentVariable("WISP_PROOF_NATIVE_CLIENT"), out var client)
        || !Guid.TryParse(Environment.GetEnvironmentVariable("WISP_PROOF_API_AUDIENCE"), out var audience)
        || authority.Scheme != "https" || !authority.Host.EndsWith(".ciamlogin.com", StringComparison.Ordinal)
        || !Guid.TryParse(authority.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault(), out _)
        || !authority.AbsolutePath.EndsWith("/v2.0", StringComparison.Ordinal)
        || !string.IsNullOrEmpty(authority.Query) || !string.IsNullOrEmpty(authority.UserInfo)
        || !string.IsNullOrEmpty(authority.Fragment) || !authority.IsDefaultPort
        || backend.Scheme != "https" || !backend.Host.StartsWith("wisp-dev-api.", StringComparison.Ordinal)
        || !backend.Host.EndsWith(".azurecontainerapps.io", StringComparison.Ordinal)
        || backend.AbsolutePath != "/" || !string.IsNullOrEmpty(backend.Query) || !string.IsNullOrEmpty(backend.UserInfo)
        || !string.IsNullOrEmpty(backend.Fragment) || !backend.IsDefaultPort)
        throw new InvalidOperationException();
    using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(10));
    var app = PublicClientApplicationBuilder.Create(client.ToString())
        .WithAuthority(authority).WithRedirectUri("http://localhost").Build();
    Console.WriteLine("Opening Microsoft's development sign-in page. Complete sign-up/sign-in in the browser; never share passwords or verification codes in chat.");
    var result = await app.AcquireTokenInteractive([$"api://{audience}/account.access"])
        .WithUseEmbeddedWebView(false).WithPrompt(Prompt.SelectAccount)
        .WithSystemWebViewOptions(new SystemWebViewOptions
        {
            HtmlMessageSuccess = "<html><body>WISP development sign-in completed. You may close this tab.</body></html>",
            HtmlMessageError = "<html><body>WISP development sign-in could not complete. You may close this tab and retry.</body></html>"
        }).ExecuteAsync(deadline.Token);
    using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
        { BaseAddress = backend, Timeout = TimeSpan.FromSeconds(45) };
    http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", result.AccessToken);
    var provision = await Provision();
    var retry = await Provision();
    var current = await http.GetFromJsonAsync<AccountView>("api/v1/account/me", deadline.Token);
    if (provision is null || current is null || retry is null || provision.ContractVersion != 1
        || provision.UserId == Guid.Empty || provision.UserId != current.UserId || provision.UserId != retry.UserId)
        throw new InvalidOperationException();
    Console.WriteLine("Real native sign-in, deployed API token validation, account read and idempotent provisioning succeeded. Website identity and rotation/restore remain separate checks.");
    foreach (var cached in await app.GetAccountsAsync()) await app.RemoveAsync(cached);
    return 0;

    async Task<AccountView?> Provision()
    {
        using var response = await http.PostAsync("api/v1/account/provision", null, deadline.Token);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<AccountView>(deadline.Token);
    }
}
catch (MsalException exception)
{
    // ErrorCode is an SDK machine code, not the provider's PII-rich response.
    Console.Error.WriteLine($"Development identity proof did not complete (MSAL code: {exception.ErrorCode}). Tokens and provider details were withheld.");
    return 1;
}
catch
{
    Console.Error.WriteLine("Development identity proof did not complete. Tokens and protected details were withheld.");
    return 1;
}

internal sealed record AccountView(int ContractVersion, Guid UserId, string DisplayName, string State);
