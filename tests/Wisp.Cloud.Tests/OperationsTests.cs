using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.AspNetCore.TestHost;
using System.Net;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.DependencyInjection;
using Wisp.Cloud.Api;
using Wisp.Cloud.Persistence;
using Npgsql;

namespace Wisp.Cloud.Tests;

public sealed class OperationsTests(CloudFixture fixture) : IClassFixture<CloudFixture>
{
    [Fact]
    public async Task Repository_uses_the_real_migrated_PostgreSQL_schema()
    {
        await using var db = fixture.Db();
        var identity = new ValidatedIdentity(CloudFixture.Issuer, Guid.Parse(CloudFixture.Tenant), Guid.NewGuid());
        var repository = new AccountRepository(db);
        Assert.Null(await repository.ReadAsync(identity, default));
        var account = await repository.ProvisionAsync(identity, default);
        Assert.Equal(account, await repository.ReadAsync(identity, default));
    }

    [Fact]
    public async Task Restricted_runtime_can_provision_and_read_but_cannot_mutate_states_or_schema()
    {
        var connection = new NpgsqlConnectionStringBuilder(fixture.Connection);
        var role = "wisp_runtime_test_" + Guid.NewGuid().ToString("N");
        // Disposable, synthetic loopback role only; no real database credentials.
        const string password = "synthetic-runtime-test-only";
        await using (var admin = new NpgsqlConnection(fixture.Connection))
        {
            await admin.OpenAsync();
            await using var bootstrap = new NpgsqlCommand($"""
                CREATE ROLE {role} LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
                GRANT USAGE ON SCHEMA {connection.SearchPath} TO {role};
                GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA {connection.SearchPath} TO {role};
                """, admin);
            await bootstrap.ExecuteNonQueryAsync();
        }
        connection.Username = role;
        connection.Password = password;
        await using var app = fixture.App(connection: connection.ConnectionString);
        await app.StartAsync();
        using var client = fixture.Client(app, Guid.NewGuid());
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/api/v1/account/provision", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/account/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/ready")).StatusCode);
        await using var runtime = new NpgsqlConnection(connection.ConnectionString);
        await runtime.OpenAsync();
        foreach (var sql in new[] { "UPDATE users SET \"State\" = 'Disabled'", "DELETE FROM users", "CREATE TABLE forbidden_probe (id integer)" })
        {
            await using var denied = new NpgsqlCommand(sql, runtime);
            var error = await Assert.ThrowsAsync<PostgresException>(() => denied.ExecuteNonQueryAsync());
            Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, error.SqlState);
        }
    }

    [Fact]
    public async Task Lifecycle_transitions_are_conditional_audited_and_deletion_is_terminal()
    {
        await using var db = fixture.Db(); var identity = new ValidatedIdentity(CloudFixture.Issuer, Guid.Parse(CloudFixture.Tenant), Guid.NewGuid());
        var user = await new AccountRepository(db).ProvisionAsync(identity, default);
        var lifecycle = new AccountLifecycle(db);
        await lifecycle.TransitionAsync(user.UserId, AccountState.Active, AccountState.Disabled, default);
        await Assert.ThrowsAsync<InvalidOperationException>(() => lifecycle.TransitionAsync(user.UserId, AccountState.Active, AccountState.Deleting, default));
        await lifecycle.TransitionAsync(user.UserId, AccountState.Disabled, AccountState.Deleting, default);
        await lifecycle.TransitionAsync(user.UserId, AccountState.Deleting, AccountState.Deleted, default);
        await Assert.ThrowsAsync<InvalidOperationException>(() => lifecycle.TransitionAsync(user.UserId, AccountState.Deleted, AccountState.Active, default));
        Assert.Equal(4, await db.AccountAudits.CountAsync(a => a.UserId == user.UserId));
        await Assert.ThrowsAsync<AccountNotActiveException>(() => new AccountRepository(db).ProvisionAsync(identity, default));
    }

    [Fact]
    public async Task Rate_limits_are_bounded_and_logs_do_not_include_private_request_content()
    {
        await using var app = fixture.App(); var capture = new CaptureLogs();
        app.Services.GetRequiredService<ILoggerFactory>().AddProvider(capture);
        await app.StartAsync(); using var client = fixture.Client(app, Guid.NewGuid());
        client.DefaultRequestHeaders.Add("X-Request-Id", "caller-secret-do-not-echo");
        var response = await client.GetAsync("/api/v1/account/me?secret=private-query-do-not-log");
        Assert.DoesNotContain("caller-secret", response.Headers.GetValues("X-Request-Id").Single());
        for (var i = 0; i < 121; i++) response = await client.GetAsync("/api/v1/account/me");
        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
        var logs = string.Join('\n', capture.Messages);
        Assert.DoesNotContain("Bearer", logs); Assert.DoesNotContain("example.invalid", logs);
        Assert.DoesNotContain("caller-secret", logs); Assert.DoesNotContain("private-query", logs);
        Assert.DoesNotContain(fixture.Connection, logs); Assert.DoesNotContain(CloudFixture.Issuer, logs);
    }

    [Fact]
    public void Production_configuration_rejects_unbounded_or_insecure_connections()
    {
        var config = new CloudConfiguration
        {
            Enabled = true,
            TenantId = Guid.Parse(CloudFixture.Tenant),
            ApiAudience = Guid.Parse(CloudFixture.Audience),
            Authority = CloudFixture.Issuer,
            Issuer = CloudFixture.Issuer,
            AllowedClientIds = [Guid.Parse(CloudFixture.DesktopClient)],
            ConnectionString = fixture.Connection
        };
        Assert.Throws<InvalidOperationException>(() => config.Validate(false));
        config.ConnectionString = "Host=private-db.postgres.database.azure.com;Database=wisp_accounts_dev;Username=wisp_runtime;SSL Mode=VerifyFull;Maximum Pool Size=20;Timeout=10;Command Timeout=15";
        config.Validate(false);
        var bounded = config.ConnectionString;
        foreach (var suffix in new[] { ";Timeout=0", ";Command Timeout=0", ";Pooling=false", ";Maximum Pool Size=21", ";Include Error Detail=true", ";Log Parameters=true" })
        {
            config.ConnectionString = bounded + suffix;
            Assert.Throws<InvalidOperationException>(() => config.Validate(false));
        }
        config.ConnectionString = bounded;
        config.Issuer = "https://untrusted.example.invalid/v2.0";
        Assert.Throws<InvalidOperationException>(() => config.Validate(false));
    }
}

internal sealed class CaptureLogs : ILoggerProvider
{
    public List<string> Messages { get; } = [];
    public ILogger CreateLogger(string categoryName) => new Capture(this);
    public void Dispose() { }
    private sealed class Capture(CaptureLogs owner) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel level) => true;
        public void Log<TState>(LogLevel level, EventId id, TState state, Exception? ex, Func<TState, Exception?, string> format)
        { lock (owner.Messages) owner.Messages.Add(format(state, ex)); }
    }
}
