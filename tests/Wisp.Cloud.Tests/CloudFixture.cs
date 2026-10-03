using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using System.IdentityModel.Tokens.Jwt;
using Wisp.Cloud.Api;
using Wisp.Cloud.Persistence;

namespace Wisp.Cloud.Tests;

public sealed class CloudFixture : IAsyncLifetime
{
    public const string Tenant = "55555555-5555-4555-8555-555555555555";
    public const string Audience = "77777777-7777-4777-8777-777777777777";
    public const string DesktopClient = "99999999-9999-4999-8999-999999999999";
    public const string WebClient = "88888888-8888-4888-8888-888888888888";
    public const string Issuer = "https://wisp-test.ciamlogin.com/" + Tenant + "/v2.0";
    private readonly RSA rsa = RSA.Create(2048);
    public RsaSecurityKey Key { get; private set; } = null!;
    public string Connection { get; private set; } = "";
    public async Task InitializeAsync()
    {
        var configured = Environment.GetEnvironmentVariable("WISP_CLOUD_TEST_CONNECTION")
            ?? throw new InvalidOperationException("Cloud tests require the dedicated loopback wisp_cloud_test database. Use tools/test-cloud-postgres.ps1 or the isolated CI service.");
        var options = new NpgsqlConnectionStringBuilder(configured);
        if (options.Database != "wisp_cloud_test" || options.Username != "wisp_cloud_test"
            || options.Host is not ("localhost" or "127.0.0.1" or "::1"))
            throw new InvalidOperationException("Refusing non-isolated cloud test configuration.");
        // Each fixture owns a fresh schema; the dedicated test database is never
        // dropped or cleared. Existing local or cloud databases cannot be used.
        options.SearchPath = "wisp_test_" + Guid.NewGuid().ToString("N");
        Connection = options.ConnectionString;
        await using var connection = new NpgsqlConnection(Connection); await connection.OpenAsync();
        await using var create = new NpgsqlCommand($"CREATE SCHEMA {options.SearchPath}", connection); await create.ExecuteNonQueryAsync();
        await using var db = Db(); await db.Database.MigrateAsync();
        Key = new(rsa) { KeyId = Guid.NewGuid().ToString("N") };
    }
    public CloudDbContext Db() => new(new DbContextOptionsBuilder<CloudDbContext>().UseNpgsql(Connection).Options);
    public Microsoft.AspNetCore.Builder.WebApplication App(bool enabled = true, string? connection = null)
    {
        var app = Program.Build([], builder =>
        {
            builder.Environment.EnvironmentName = "Development";
            builder.WebHost.UseTestServer();
            var config = builder.Configuration;
            config["Cloud:Enabled"] = enabled.ToString(); config["Cloud:Authority"] = Issuer;
            config["Cloud:Issuer"] = Issuer; config["Cloud:TenantId"] = Tenant; config["Cloud:ApiAudience"] = Audience;
            config["Cloud:AllowedClientIds:0"] = DesktopClient; config["Cloud:AllowedClientIds:1"] = WebClient;
            config["Cloud:ConnectionString"] = connection ?? Connection;
            builder.Services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, o =>
            {
                // Real RSA validation, but offline synthetic metadata/signing
                // keys injected through test DI only; no production test bypass.
                var metadata = new OpenIdConnectConfiguration { Issuer = Issuer }; metadata.SigningKeys.Add(Key);
                o.ConfigurationManager = new StaticConfigurationManager<OpenIdConnectConfiguration>(metadata);
            });
        });
        return app;
    }
    public string Token(Guid subject, string? variant = null, string client = DesktopClient, string email = "private@example.invalid")
    {
        var claims = new List<Claim> {
            new("tid", variant == "tenant" ? Guid.NewGuid().ToString() : Tenant),
            new("oid", variant == "object" ? "not-an-object-id" : subject.ToString()), new("azp", variant == "client" ? Guid.NewGuid().ToString() : client),
            new("ver", variant == "version" ? "1.0" : "2.0"), new("sub", client + "-pairwise"), new("email", email),
        };
        if (variant != "idtoken") claims.Add(new("scp", variant == "scope" ? "other.access" : "account.access"));
        if (variant == "duplicate") claims.Add(new("oid", Guid.NewGuid().ToString()));
        using var wrong = RSA.Create(2048);
        var signing = variant == "unsigned" ? null : variant == "algorithm"
            ? new SigningCredentials(new SymmetricSecurityKey(RandomNumberGenerator.GetBytes(32)) { KeyId = Key.KeyId }, SecurityAlgorithms.HmacSha256)
            : new SigningCredentials(variant == "signature" ? new RsaSecurityKey(wrong) { KeyId = Key.KeyId } : Key, SecurityAlgorithms.RsaSha256);
        var jwt = new JwtSecurityToken(variant == "issuer" ? "https://untrusted.example.invalid" : Issuer,
            variant == "audience" ? Guid.NewGuid().ToString() : Audience, claims,
            DateTime.UtcNow.AddMinutes(variant == "future" ? 5 : -10), DateTime.UtcNow.AddMinutes(variant == "expired" ? -2 : 10), signing);
        return new JwtSecurityTokenHandler().WriteToken(jwt);
    }
    public HttpClient Client(Microsoft.AspNetCore.Builder.WebApplication app, Guid subject, string? variant = null, string client = DesktopClient)
    {
        var http = app.GetTestClient(); http.DefaultRequestHeaders.Authorization = new("Bearer", Token(subject, variant, client)); return http;
    }
    public Task DisposeAsync() { rsa.Dispose(); return Task.CompletedTask; }
}
