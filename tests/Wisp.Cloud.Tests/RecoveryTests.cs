using System.Diagnostics;
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Wisp.Cloud.Persistence;
using Wisp.Cloud.Persistence.Migrations;

[assembly: CollectionBehavior(DisableTestParallelization = true)]

namespace Wisp.Cloud.Tests;

public sealed class RecoveryTests(CloudFixture fixture) : IClassFixture<CloudFixture>
{
    [Fact]
    public async Task Failed_EF_migration_rolls_back_its_DDL_and_history_without_changing_accounts()
    {
        await using var source = fixture.Db();
        var identity = new ValidatedIdentity(CloudFixture.Issuer, Guid.Parse(CloudFixture.Tenant), Guid.NewGuid());
        var account = await new AccountRepository(source).ProvisionAsync(identity, default);
        await using var failing = new CloudDbContext(new DbContextOptionsBuilder<CloudDbContext>().UseNpgsql(fixture.Connection)
            .ReplaceService<IMigrationsAssembly, FailureAssembly>().Options);
        await Assert.ThrowsAsync<PostgresException>(() => failing.Database.MigrateAsync());
        Assert.Equal(account, await new AccountRepository(source).ReadAsync(identity, default));
        Assert.DoesNotContain(FailureAssembly.FailureId, await source.Database.GetAppliedMigrationsAsync());
        await using var conn = new NpgsqlConnection(fixture.Connection); await conn.OpenAsync();
        await using var probe = new NpgsqlCommand("SELECT to_regclass('failed_migration_probe') IS NULL", conn);
        Assert.Equal(true, await probe.ExecuteScalarAsync());
    }

    [Fact]
    public async Task Schema_can_roll_back_and_reapply_on_an_empty_owned_fixture()
    {
        var empty = new CloudFixture(); await empty.InitializeAsync();
        try
        {
            await using var db = empty.Db();
            await db.GetService<IMigrator>().MigrateAsync("0");
            Assert.Empty(await db.Database.GetAppliedMigrationsAsync());
            await db.Database.MigrateAsync();
            Assert.Single(await db.Database.GetAppliedMigrationsAsync());
            Assert.Empty(await db.Users.ToArrayAsync());
        }
        finally { await empty.DisposeAsync(); }
    }

    [Fact]
    public async Task Real_pg_dump_restore_preserves_account_identity_profile_state_and_audit()
    {
        await using var sourceDb = fixture.Db();
        var identity = new ValidatedIdentity(CloudFixture.Issuer, Guid.Parse(CloudFixture.Tenant), Guid.NewGuid());
        var account = await new AccountRepository(sourceDb).ProvisionAsync(identity, default);
        var source = new NpgsqlConnectionStringBuilder(fixture.Connection);
        var restoreDatabase = "wisp_restore_" + Guid.NewGuid().ToString("N");
        await using (var conn = new NpgsqlConnection(fixture.Connection))
        {
            await conn.OpenAsync();
            await using var create = new NpgsqlCommand($"CREATE DATABASE {restoreDatabase}", conn); await create.ExecuteNonQueryAsync();
        }
        var container = Environment.GetEnvironmentVariable("WISP_CLOUD_TEST_PG_CONTAINER_ID");
        var root = Path.Combine(Path.GetTempPath(), "wisp-cloud-backup-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
        var dump = container is null ? Path.Combine(root, "test.dump") : "/tmp/wisp-test-" + Guid.NewGuid().ToString("N") + ".dump";
        await Tool("pg_dump", ["--host", container is null ? source.Host! : "127.0.0.1", "--port", container is null ? source.Port.ToString() : "5432",
            "--username", "wisp_cloud_test", "--dbname", "wisp_cloud_test", "--format=custom", "--no-owner", "--no-acl", "--file", dump], container, source.Password);
        await Tool("pg_restore", ["--host", container is null ? source.Host! : "127.0.0.1", "--port", container is null ? source.Port.ToString() : "5432",
            "--username", "wisp_cloud_test", "--dbname", restoreDatabase, "--no-owner", "--no-acl", "--exit-on-error", dump], container, source.Password);
        source.Database = restoreDatabase;
        await using var restored = new CloudDbContext(new DbContextOptionsBuilder<CloudDbContext>().UseNpgsql(source.ConnectionString).Options);
        Assert.Equal(account, await new AccountRepository(restored).ReadAsync(identity, default));
        Assert.Equal(await sourceDb.AccountAudits.CountAsync(a => a.UserId == account.UserId),
            await restored.AccountAudits.CountAsync(a => a.UserId == account.UserId));
        Assert.Equal(await sourceDb.Database.GetAppliedMigrationsAsync(), await restored.Database.GetAppliedMigrationsAsync());
    }
    private static async Task Tool(string tool, string[] args, string? container, string? password)
    {
        var binaryRoot = Environment.GetEnvironmentVariable("WISP_CLOUD_TEST_PG_BIN");
        var start = new ProcessStartInfo
        {
            FileName = container is null ? Path.Combine(binaryRoot ?? throw new InvalidOperationException("Supply test-only PostgreSQL binaries."), tool + (OperatingSystem.IsWindows() ? ".exe" : "")) : "docker",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        if (container is not null)
        {
            if (!System.Text.RegularExpressions.Regex.IsMatch(container, "^[a-zA-Z0-9]{8,64}$")) throw new InvalidOperationException("Invalid isolated CI container.");
            foreach (var arg in new[] { "exec", "-e", "PGPASSWORD", container, tool }) start.ArgumentList.Add(arg);
        }
        // Forward only this synthetic fixture password through the child environment,
        // including docker exec. Never put a password in command-line arguments.
        if (password is not null) start.Environment["PGPASSWORD"] = password;
        foreach (var arg in args) start.ArgumentList.Add(arg);
        using var process = Process.Start(start)!;
        var output = process.StandardOutput.ReadToEndAsync(); var error = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        try { await process.WaitForExitAsync(timeout.Token); }
        catch { process.Kill(entireProcessTree: true); throw; }
        await output; await error;
        Assert.True(process.ExitCode == 0, "Synthetic database recovery utility failed; private output was withheld.");
    }
}

internal sealed class FailureAssembly : IMigrationsAssembly
{
    public const string FailureId = "99991231235959_SyntheticFailure";
    private static string InitialId => typeof(InitialCloudAccounts).GetCustomAttribute<MigrationAttribute>()!.Id;
    public IReadOnlyDictionary<string, TypeInfo> Migrations => new Dictionary<string, TypeInfo>
    {
        [InitialId] = typeof(InitialCloudAccounts).GetTypeInfo(),
        [FailureId] = typeof(FailedMigration).GetTypeInfo(),
    };
    public ModelSnapshot? ModelSnapshot => (ModelSnapshot)Activator.CreateInstance(
        typeof(InitialCloudAccounts).Assembly.GetType("Wisp.Cloud.Persistence.Migrations.CloudDbContextModelSnapshot")!, nonPublic: true)!;
    public Assembly Assembly => typeof(FailureAssembly).Assembly;
    public string? FindMigrationId(string name) => Migrations.Keys.FirstOrDefault(id => id == name || id.EndsWith("_" + name));
    public Migration CreateMigration(TypeInfo type, string activeProvider)
    { var migration = (Migration)Activator.CreateInstance(type.AsType())!; migration.ActiveProvider = activeProvider; return migration; }
}
[Migration(FailureAssembly.FailureId)]
internal sealed class FailedMigration : Migration
{
    protected override void Up(MigrationBuilder builder) { builder.Sql("CREATE TABLE failed_migration_probe (id integer); SELECT 1 / 0;"); }
    protected override void Down(MigrationBuilder builder) => builder.Sql("DROP TABLE failed_migration_probe");
}
