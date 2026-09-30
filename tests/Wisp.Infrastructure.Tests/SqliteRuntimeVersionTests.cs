using Microsoft.Data.Sqlite;

namespace Wisp.Infrastructure.Tests;

public class SqliteRuntimeVersionTests
{
    [Fact]
    public async Task Bundled_sqlite_is_newer_than_the_security_fix_baseline()
    {
        // In-memory only. Never open/migrate a user's music library for this check.
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var version = Version.Parse(connection.ServerVersion);
        Assert.True(version >= new Version(3, 50, 2), $"Outdated bundled SQLite: {version}");
    }
}
