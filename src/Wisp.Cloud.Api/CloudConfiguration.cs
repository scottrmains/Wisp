using Npgsql;

namespace Wisp.Cloud.Api;

public sealed class CloudConfiguration
{
    public bool Enabled { get; set; }
    public string Authority { get; set; } = "";
    public string Issuer { get; set; } = "";
    public Guid TenantId { get; set; }
    public Guid ApiAudience { get; set; }
    public Guid[] AllowedClientIds { get; set; } = [];
    public string RequiredScope { get; set; } = "account.access";
    public string ConnectionString { get; set; } = "";
    public void Validate(bool development)
    {
        if (!Enabled) return;
        if (TenantId == Guid.Empty || ApiAudience == Guid.Empty || AllowedClientIds.Length is 0 or > 10
            || AllowedClientIds.Any(c => c == Guid.Empty) || RequiredScope != "account.access"
            || !MicrosoftHttps(Authority) || !MicrosoftHttps(Issuer)
            || new Uri(Issuer).AbsolutePath.Trim('/') != $"{TenantId:D}/v2.0")
            throw new InvalidOperationException("Cloud identity configuration is incomplete or invalid.");
        try
        {
            var db = new NpgsqlConnectionStringBuilder(ConnectionString);
            if (string.IsNullOrWhiteSpace(db.Host) || string.IsNullOrWhiteSpace(db.Database) || string.IsNullOrWhiteSpace(db.Username)
                || db.IncludeErrorDetail || db.LogParameters || !db.Pooling || db.MaxPoolSize > 20
                || db.Timeout is <= 0 or > 15 || db.CommandTimeout is <= 0 or > 30
                || (!development && (db.SslMode != SslMode.VerifyFull || db.Username != "wisp_runtime" || db.Database is "wisp.db" or "postgres")))
                throw new ArgumentException();
        }
        catch (Exception ex) when (ex is ArgumentException or FormatException)
        { throw new InvalidOperationException("Cloud database configuration must be explicit, bounded and securely connected."); }
    }
    private static bool MicrosoftHttps(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == "https" && uri.UserInfo.Length == 0 && uri.Query.Length == 0 && uri.Fragment.Length == 0
        && uri.IsDefaultPort && (uri.Host.EndsWith(".ciamlogin.com", StringComparison.OrdinalIgnoreCase)
            || uri.Host == "login.microsoftonline.com");
}
