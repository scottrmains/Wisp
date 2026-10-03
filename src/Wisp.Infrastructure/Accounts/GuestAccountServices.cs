using Wisp.Core.Accounts;

namespace Wisp.Infrastructure.Accounts;

// Deployment configuration, not WispSettings/catalog credentials. Valid settings
// cannot activate a provider that has not been implemented.
public sealed record CloudAccountConfiguration(bool Enabled = false, string? ApiBaseUrl = null,
    string? Authority = null, string? ClientId = null)
{
    public CloudAvailability Availability => !Enabled ? CloudAvailability.Disabled
        : string.IsNullOrWhiteSpace(ApiBaseUrl) || string.IsNullOrWhiteSpace(Authority) || string.IsNullOrWhiteSpace(ClientId)
            ? CloudAvailability.MissingConfiguration
        : !IsSecureEndpoint(ApiBaseUrl) || !IsSecureEndpoint(Authority)
            ? CloudAvailability.InvalidConfiguration
        : CloudAvailability.NotImplemented;
    private static bool IsSecureEndpoint(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps && string.IsNullOrEmpty(uri.UserInfo)
        && string.IsNullOrEmpty(uri.Query) && string.IsNullOrEmpty(uri.Fragment);
}

public sealed class GuestAccountSessionService(CloudAccountConfiguration configuration) : IAccountSessionService
{
    public Task<AccountSession> GetSessionAsync(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(new AccountSession(AccountSessionState.Guest, null, configuration.Availability));
    }
    public Task SignInAsync(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        throw new CloudUnavailableException();
    }
    public Task SignOutAsync(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}
public sealed class NoCloudAccountClient : ICloudAccountClient
{
    public Task<AccountProfile> GetCurrentUserAsync(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        throw new CloudUnavailableException();
    }
}
public sealed class GuestEntitlementService : IEntitlementService
{
    private static readonly IReadOnlyList<LocalCapability> Local = Array.AsReadOnly(Enum.GetValues<LocalCapability>());
    public Task<CapabilitySnapshot> GetCapabilitiesAsync(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(new CapabilitySnapshot(Local, false));
    }
}
// Fail closed: real OS-protected storage belongs to Phase 3, with no plaintext
// fallback or false claim that credentials were securely saved.
public sealed class UnavailableAccountTokenStore : IProtectedAccountTokenStore
{
    public bool IsAvailable => false;
    public Task<byte[]?> ReadAsync(CancellationToken ct = default) => Unavailable<byte[]?>(ct);
    public Task WriteAsync(ReadOnlyMemory<byte> cache, CancellationToken ct = default) => Unavailable<object>(ct);
    public Task ClearAsync(CancellationToken ct = default) => Unavailable<object>(ct);
    private static Task<T> Unavailable<T>(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        throw new CloudUnavailableException();
    }
}
