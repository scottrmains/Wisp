namespace Wisp.Core.Accounts;

public enum AccountSessionState { Guest, Connecting, SignedIn, Offline, SignInRequired }
public enum CloudAvailability { Disabled, MissingConfiguration, InvalidConfiguration, NotImplemented, Available }
public enum LocalCapability { Library, Playback, Recording, Cues, Analysis, Playlists, MixPlans, CdjExport, Downloads, Cleanup }

// No tokens, file paths, provider credentials or billing data in UI-facing state.
public sealed record AccountProfile(Guid UserId, string DisplayName, string? PublicHandle);
public sealed record AccountSession(AccountSessionState State, AccountProfile? User, CloudAvailability Cloud);
public sealed record CapabilitySnapshot(IReadOnlyList<LocalCapability> Local, bool CloudAvailable);

public interface IAccountSessionService
{
    Task<AccountSession> GetSessionAsync(CancellationToken ct = default);
    Task SignInAsync(CancellationToken ct = default);
    Task SignOutAsync(CancellationToken ct = default);
}
public interface ICloudAccountClient
{
    Task<AccountProfile> GetCurrentUserAsync(CancellationToken ct = default);
}
public interface IEntitlementService
{
    Task<CapabilitySnapshot> GetCapabilitiesAsync(CancellationToken ct = default);
}
// Native-only opaque cache bytes. A future adapter must protect these with the OS.
// Never map this interface to HTTP endpoints or the Photino bridge.
public interface IProtectedAccountTokenStore
{
    bool IsAvailable { get; }
    Task<byte[]?> ReadAsync(CancellationToken ct = default);
    Task WriteAsync(ReadOnlyMemory<byte> cache, CancellationToken ct = default);
    Task ClearAsync(CancellationToken ct = default);
}
public interface IInstallationIdentityStore
{
    Task<Guid> GetAsync(CancellationToken ct = default);
}
// Future explicit association, not authority. Phase 1 neither persists a binding
// nor claims local records. Installation/workspace IDs do not authenticate users.
public sealed record WorkspaceCloudBinding(Guid WorkspaceId, Guid UserId);
public sealed class CloudUnavailableException() : InvalidOperationException("Cloud accounts are not available in this build.");
