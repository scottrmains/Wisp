using Wisp.Core.Accounts;
using Wisp.Infrastructure.Accounts;

namespace Wisp.Infrastructure.Tests;

public sealed class AccountGroundworkTests
{
    [Theory]
    [InlineData(false, null, null, null, CloudAvailability.Disabled)]
    [InlineData(true, null, null, null, CloudAvailability.MissingConfiguration)]
    [InlineData(true, "http://example.test", "https://login.example.test", "client", CloudAvailability.InvalidConfiguration)]
    [InlineData(true, "https://user:password@example.test", "https://login.example.test", "client", CloudAvailability.InvalidConfiguration)]
    [InlineData(true, "https://example.test", "https://login.example.test?secret=x", "client", CloudAvailability.InvalidConfiguration)]
    [InlineData(true, "https://example.test", "https://login.example.test", "client", CloudAvailability.NotImplemented)]
    public async Task Configuration_never_enables_a_provider_or_changes_guest_permissions(bool enabled, string? api,
        string? authority, string? client, CloudAvailability expected)
    {
        var session = new GuestAccountSessionService(new(enabled, api, authority, client));
        var state = await session.GetSessionAsync();
        Assert.Equal(AccountSessionState.Guest, state.State); Assert.Null(state.User); Assert.Equal(expected, state.Cloud);
        await Assert.ThrowsAsync<CloudUnavailableException>(() => session.SignInAsync());
        await session.SignOutAsync();
        Assert.Equal(state, await session.GetSessionAsync());
        var capabilities = await new GuestEntitlementService().GetCapabilitiesAsync();
        Assert.Equal(Enum.GetValues<LocalCapability>(), capabilities.Local); Assert.False(capabilities.CloudAvailable);
        await Assert.ThrowsAsync<CloudUnavailableException>(() => new NoCloudAccountClient().GetCurrentUserAsync());
    }

    [Fact]
    public async Task Token_store_fails_closed_without_a_plaintext_fallback()
    {
        var store = new UnavailableAccountTokenStore();
        Assert.False(store.IsAvailable);
        await Assert.ThrowsAsync<CloudUnavailableException>(() => store.WriteAsync(new byte[] { 1, 2 }));
        await Assert.ThrowsAsync<CloudUnavailableException>(() => store.ReadAsync());
        await Assert.ThrowsAsync<CloudUnavailableException>(() => store.ClearAsync());
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        await Assert.ThrowsAsync<OperationCanceledException>(() => store.ReadAsync(cancelled.Token));
        await Assert.ThrowsAsync<OperationCanceledException>(() => new GuestAccountSessionService(new()).GetSessionAsync(cancelled.Token));
        await Assert.ThrowsAsync<OperationCanceledException>(() => new NoCloudAccountClient().GetCurrentUserAsync(cancelled.Token));
    }

    [Fact]
    public async Task Installation_identity_is_lazy_stable_atomic_and_separate_from_user_data()
    {
        var root = Path.Combine(Path.GetTempPath(), "wisp-account-id-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var settingsPath = Path.Combine(root, "config.json");
            var databasePath = Path.Combine(root, "wisp.db");
            await File.WriteAllTextAsync(settingsPath, "keep-settings"); await File.WriteAllTextAsync(databasePath, "keep-library");
            var path = Path.Combine(root, "account-installation.id");
            var store = new InstallationIdentityStore(path); Assert.False(File.Exists(path));
            var ids = await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => new InstallationIdentityStore(path).GetAsync()));
            Assert.NotEqual(Guid.Empty, ids[0]); Assert.All(ids, id => Assert.Equal(ids[0], id));
            Assert.Equal(ids[0], await store.GetAsync()); Assert.Equal(ids[0], await new InstallationIdentityStore(path).GetAsync());
            Assert.Equal("keep-settings", await File.ReadAllTextAsync(settingsPath));
            Assert.Equal("keep-library", await File.ReadAllTextAsync(databasePath));
            Assert.Empty(Directory.GetFiles(root, "*.tmp"));
            var other = await new InstallationIdentityStore(Path.Combine(root, "second-profile", "account-installation.id")).GetAsync();
            Assert.NotEqual(ids[0], other);
            await File.WriteAllTextAsync(path, "invalid-preserve-me");
            await Assert.ThrowsAsync<InvalidDataException>(() => store.GetAsync());
            Assert.Equal("invalid-preserve-me", await File.ReadAllTextAsync(path));
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Cancelled_identity_request_creates_no_files()
    {
        var root = Path.Combine(Path.GetTempPath(), "wisp-account-cancel-" + Guid.NewGuid().ToString("N"));
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        await Assert.ThrowsAsync<OperationCanceledException>(() => new InstallationIdentityStore(Path.Combine(root, "account-installation.id")).GetAsync(cancelled.Token));
        Assert.False(Directory.Exists(root));
    }
}
