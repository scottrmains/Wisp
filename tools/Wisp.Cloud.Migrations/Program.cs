using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Wisp.Cloud.Persistence;

// Explicit operator job, never desktop/API startup. Refuses production targets.
// Secret references supply credentials; values and exception messages never log.
try
{
    if (args is not ["--approved-development-bootstrap"])
        throw new InvalidOperationException();
    var connection = new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("WISP_CLOUD_MIGRATION_CONNECTION"));
    var password = Environment.GetEnvironmentVariable("WISP_CLOUD_RUNTIME_PASSWORD") ?? "";
    if (connection.Database != "wisp_accounts_dev" || connection.Username != "wisp_migration_admin"
        || connection.Host is null || !connection.Host.EndsWith(".postgres.database.azure.com", StringComparison.Ordinal)
        || connection.SslMode != SslMode.VerifyFull || connection.IncludeErrorDetail || connection.LogParameters
        || connection.Timeout is <= 0 or > 15 || connection.CommandTimeout is <= 0 or > 30
        || connection.MaxPoolSize > 5 || !Regex.IsMatch(password, "^[A-F0-9]{64}$"))
        throw new InvalidOperationException();
    using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(5));
    await using var db = new CloudDbContext(new DbContextOptionsBuilder<CloudDbContext>().UseNpgsql(connection.ConnectionString).Options);
    await db.Database.MigrateAsync(deadline.Token);
    await using var admin = new NpgsqlConnection(connection.ConnectionString);
    await admin.OpenAsync(deadline.Token);
    await using var transaction = await admin.BeginTransactionAsync(deadline.Token);
    await using (var secret = new NpgsqlCommand("SELECT set_config('wisp.runtime_password', @password, true)", admin, transaction))
    {
        secret.Parameters.AddWithValue("password", password);
        await secret.ExecuteNonQueryAsync(deadline.Token);
    }
    await using (var bootstrap = new NpgsqlCommand("""
        DO $bootstrap$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wisp_runtime') THEN
            CREATE ROLE wisp_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wisp_runtime' AND (rolsuper OR rolcreatedb OR rolcreaterole)) THEN
            RAISE EXCEPTION 'Unexpected elevated runtime role; operator review required';
          END IF;
          EXECUTE format('ALTER ROLE wisp_runtime LOGIN PASSWORD %L', current_setting('wisp.runtime_password'));
        END $bootstrap$;
        REVOKE ALL ON DATABASE wisp_accounts_dev FROM PUBLIC;
        GRANT CONNECT ON DATABASE wisp_accounts_dev TO wisp_runtime;
        REVOKE ALL ON SCHEMA public FROM PUBLIC;
        GRANT USAGE ON SCHEMA public TO wisp_runtime;
        GRANT SELECT, INSERT ON TABLE public.users, public.private_profiles, public.auth_identities, public.account_audits TO wisp_runtime;
        """, admin, transaction))
        await bootstrap.ExecuteNonQueryAsync(deadline.Token);
    await transaction.CommitAsync(deadline.Token);
    connection.Username = "wisp_runtime";
    connection.Password = password;
    connection.MaxPoolSize = 5;
    await using var runtime = new NpgsqlConnection(connection.ConnectionString);
    await runtime.OpenAsync(deadline.Token);
    await using (var read = new NpgsqlCommand("SELECT 1 FROM public.users LIMIT 1", runtime))
        await read.ExecuteScalarAsync(deadline.Token);
    await using var permissions = new NpgsqlCommand("""
        SELECT has_table_privilege(current_user, 'public.users', 'INSERT')
          AND NOT has_table_privilege(current_user, 'public.users', 'UPDATE')
          AND NOT has_table_privilege(current_user, 'public.users', 'DELETE')
          AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
        """, runtime);
    if (!Equals(true, await permissions.ExecuteScalarAsync(deadline.Token))) throw new InvalidOperationException();
    Console.WriteLine("Development migrations and restricted-runtime verification succeeded.");
    return 0;
}
catch
{
    Console.Error.WriteLine("Development migration/bootstrap failed. Protected details were withheld; inspect the authorized deployment privately.");
    return 1;
}
