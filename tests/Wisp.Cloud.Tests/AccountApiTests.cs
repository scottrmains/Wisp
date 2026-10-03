using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Wisp.Cloud.Persistence;

namespace Wisp.Cloud.Tests;

public sealed class AccountApiTests : IClassFixture<CloudFixture>
{
    private readonly CloudFixture fixture;
    public AccountApiTests(CloudFixture fixture) { this.fixture = fixture; }

    [Theory]
    [InlineData("expired", 401)]
    [InlineData("signature", 401)]
    [InlineData("issuer", 401)]
    [InlineData("audience", 401)]
    [InlineData("tenant", 401)]
    [InlineData("client", 401)]
    [InlineData("duplicate", 401)]
    [InlineData("scope", 403)]
    [InlineData("idtoken", 403)]
    [InlineData("unsigned", 401)]
    [InlineData("algorithm", 401)]
    [InlineData("object", 401)]
    [InlineData("version", 401)]
    [InlineData("future", 401)]
    public async Task Untrusted_or_non_delegated_tokens_cannot_provision(string variant, int expected)
    {
        await using var app = fixture.App(); await app.StartAsync();
        using var client = fixture.Client(app, Guid.NewGuid(), variant);
        Assert.Equal(expected, (int)(await client.PostAsync("/api/v1/account/provision", null)).StatusCode);
        var response = await client.GetAsync("/api/v1/account/me"); Assert.Equal(expected, (int)response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("private@example", body); Assert.DoesNotContain("Bearer", body);
    }
    [Fact]
    public async Task Anonymous_and_disabled_service_fail_closed_without_desktop_login()
    {
        await using var app = fixture.App(false); await app.StartAsync();
        using var anonymous = app.GetTestClient();
        Assert.Equal(HttpStatusCode.OK, (await anonymous.GetAsync("/health/live")).StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await anonymous.GetAsync("/health/ready")).StatusCode);
        using var bearer = fixture.Client(app, Guid.NewGuid());
        foreach (var client in new[] { anonymous, bearer })
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/account/me")).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/v1/account/provision", null)).StatusCode);
        }
    }
    [Fact]
    public async Task Parallel_first_signins_email_changes_and_cross_client_subjects_keep_one_user()
    {
        var subject = Guid.NewGuid(); await using var app = fixture.App(); await app.StartAsync();
        using var client = fixture.Client(app, subject);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/v1/account/me")).StatusCode);
        var responses = await Task.WhenAll(Enumerable.Range(0, 16).Select(_ => client.PostAsync("/api/v1/account/provision", null)));
        foreach (var response in responses) response.EnsureSuccessStatusCode();
        var users = await Task.WhenAll(responses.Select(r => r.Content.ReadFromJsonAsync<AccountView>()));
        Assert.Single(users.Select(u => u!.UserId).Distinct());
        using var browser = fixture.Client(app, subject, client: CloudFixture.WebClient);
        browser.DefaultRequestHeaders.Authorization = new("Bearer", fixture.Token(subject, client: CloudFixture.WebClient, email: "changed@example.invalid"));
        var same = await browser.GetFromJsonAsync<AccountView>("/api/v1/account/me");
        Assert.Equal(users[0]!.UserId, same!.UserId);
        await using var db = fixture.Db();
        Assert.Equal(1, await db.Identities.CountAsync(i => i.ObjectId == subject));
        Assert.Equal(1, await db.AccountAudits.CountAsync(a => a.UserId == same.UserId));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/ready")).StatusCode);
    }
    [Theory]
    [InlineData(AccountState.Disabled)]
    [InlineData(AccountState.Deleting)]
    [InlineData(AccountState.Deleted)]
    public async Task Valid_token_cannot_resurrect_a_restricted_account(AccountState state)
    {
        await using var app = fixture.App(); await app.StartAsync(); var subject = Guid.NewGuid();
        using var client = fixture.Client(app, subject);
        var provision = await client.PostAsync("/api/v1/account/provision", null); provision.EnsureSuccessStatusCode();
        var user = (await provision.Content.ReadFromJsonAsync<AccountView>())!;
        await using var db = fixture.Db();
        await db.Users.Where(u => u.Id == user.UserId).ExecuteUpdateAsync(s => s.SetProperty(u => u.State, state));
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/v1/account/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync("/api/v1/account/provision", null)).StatusCode);
        Assert.Equal(state, (await db.Users.SingleAsync(u => u.Id == user.UserId)).State);
        Assert.Equal(1, await db.Identities.CountAsync(i => i.ObjectId == subject));
    }
    [Fact]
    public async Task Users_can_only_read_the_identity_from_the_validated_token()
    {
        await using var app = fixture.App(); await app.StartAsync();
        using var first = fixture.Client(app, Guid.NewGuid()); using var second = fixture.Client(app, Guid.NewGuid());
        var a = await first.PostAsync("/api/v1/account/provision", null); var b = await second.PostAsync("/api/v1/account/provision", null);
        a.EnsureSuccessStatusCode(); b.EnsureSuccessStatusCode();
        var userA = (await a.Content.ReadFromJsonAsync<AccountView>())!; var userB = (await b.Content.ReadFromJsonAsync<AccountView>())!;
        Assert.NotEqual(userA.UserId, userB.UserId);
        Assert.Equal(userB.UserId, (await second.GetFromJsonAsync<AccountView>($"/api/v1/account/me?userId={userA.UserId}"))!.UserId);
        Assert.Equal(HttpStatusCode.NotFound, (await second.GetAsync($"/api/v1/account/{userA.UserId}")).StatusCode);
        var response = await second.GetAsync("/api/v1/account/me");
        Assert.Equal(HttpStatusCode.BadRequest, (await second.PostAsJsonAsync("/api/v1/account/provision", new { userId = userA.UserId })).StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl!.ToString()); Assert.True(response.Headers.Contains("X-Request-Id"));
        Assert.DoesNotContain("example.invalid", await response.Content.ReadAsStringAsync());
    }
}
