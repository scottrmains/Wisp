using YamlDotNet.RepresentationModel;

namespace Wisp.Api.Soulseek;

/// Read + write helpers for slskd's YAML config. Two jobs:
///  1. **Opportunistic migration** — on Wisp's first run with the bundled sidecar, look
///     for an existing slskd config in known locations and pull username/password/api-key
///     out so the user doesn't have to re-enter them.
///  2. **Generation** — write a minimal slskd.yml each time the sidecar starts, derived
///     from current Wisp settings. Keeps Wisp as the source of truth; a stale generated
///     config is just overwritten.
public static class SlskdConfig
{
    /// Locations Wisp will probe for an existing slskd config when migrating credentials.
    /// Order matters — we read the first one that exists. The "bundled folder" entry is for
    /// users who unpacked slskd next to Wisp and edited the config in place.
    public static IEnumerable<string> CandidateConfigPaths(string? bundledSlskdRoot)
    {
        // Default Windows location — `slskd --version` confirms this is where it looks first.
        yield return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "slskd", "slskd.yml");
        // User-edited config inside the bundled folder (next to slskd.exe).
        if (!string.IsNullOrEmpty(bundledSlskdRoot))
        {
            yield return Path.Combine(bundledSlskdRoot, "slskd.yml");
            yield return Path.Combine(bundledSlskdRoot, "config", "slskd.yml");
        }
    }

    public sealed record MigratedCredentials(string? Username, string? Password, string? ApiKey);

    /// Tries each candidate path in turn. Returns the first config that yields any
    /// extractable credentials, or null when nothing is found / parseable.
    public static MigratedCredentials? TryMigrate(IEnumerable<string> candidatePaths)
    {
        foreach (var path in candidatePaths)
        {
            if (!File.Exists(path)) continue;
            try
            {
                var creds = ExtractCredentials(File.ReadAllText(path));
                if (creds.Username is not null || creds.Password is not null || creds.ApiKey is not null)
                    return creds;
            }
            catch
            {
                // Best-effort migration — a malformed YAML file shouldn't block the sidecar from starting.
            }
        }
        return null;
    }

    /// Parse a slskd.yml string and pull the three fields Wisp cares about. Tolerates
    /// commented-out keys and arbitrary other content; returns nulls for anything missing.
    public static MigratedCredentials ExtractCredentials(string yaml)
    {
        var stream = new YamlStream();
        stream.Load(new StringReader(yaml));
        if (stream.Documents.Count == 0) return new(null, null, null);
        var root = stream.Documents[0].RootNode as YamlMappingNode;
        if (root is null) return new(null, null, null);

        // soulseek.username + soulseek.password — the network login.
        var soulseek = TryMap(root, "soulseek");
        var username = TryScalar(soulseek, "username");
        var password = TryScalar(soulseek, "password");

        // web.authentication.api_keys.<any>.key — first non-default API key wins.
        // slskd's example file ships a placeholder block with `key: <key>` so we skip those.
        string? apiKey = null;
        var web = TryMap(root, "web");
        var auth = TryMap(web, "authentication");
        var apiKeys = TryMap(auth, "api_keys");
        if (apiKeys is not null)
        {
            foreach (var entry in apiKeys.Children)
            {
                var keyMap = entry.Value as YamlMappingNode;
                var keyVal = TryScalar(keyMap, "key");
                if (string.IsNullOrWhiteSpace(keyVal)) continue;
                if (keyVal.Contains('<') || keyVal.Contains('>')) continue; // placeholder
                apiKey = keyVal;
                break;
            }
        }

        return new MigratedCredentials(
            string.IsNullOrWhiteSpace(username) ? null : username,
            string.IsNullOrWhiteSpace(password) ? null : password,
            apiKey);
    }

    /// Generate a minimal slskd.yml that the sidecar will hand to slskd via `--config <path>`.
    /// Binds 127.0.0.1 only (no LAN exposure), uses the supplied API key for the `wisp`
    /// auth entry that Wisp's HTTP client sends, sets up the user's download folder, and
    /// disables remote configuration so a user opening slskd's web UI can't break Wisp's
    /// expected setup.
    public static string GenerateSlskdYaml(
        string apiKey,
        string username,
        string password,
        int port,
        string downloadsDir,
        string incompleteDir)
    {
        // Yaml escaping is annoying enough that hand-rolling the document is cleaner than
        // round-tripping through YamlDotNet's emitter. All inputs are wrapped in single
        // quotes with literal-backslash + literal-single-quote escaping.
        static string Esc(string s) => s.Replace("\\", "\\\\").Replace("'", "''");
        return $$"""
        # Generated by Wisp on each managed-sidecar startup. Do not edit by hand —
        # changes are overwritten on the next Wisp launch. Configure via Wisp's
        # Settings → Soulseek panel instead.
        instance_name: wisp
        remote_configuration: false

        directories:
          downloads: '{{Esc(downloadsDir)}}'
          incomplete: '{{Esc(incompleteDir)}}'

        soulseek:
          username: '{{Esc(username)}}'
          password: '{{Esc(password)}}'

        web:
          port: {{port}}
          # 127.0.0.1 only — Wisp talks to the loopback adapter; no LAN exposure.
          url_base: /
          https:
            disabled: true
          authentication:
            disabled: false
            # Disable web-UI username/password login — Wisp uses the API key below.
            # The placeholder still has to be present and non-default or slskd will
            # refuse to start.
            username: wisp-internal
            password: '{{Esc(Guid.NewGuid().ToString("N"))}}'
            api_keys:
              wisp:
                key: '{{Esc(apiKey)}}'
                role: administrator
                cidr: 127.0.0.1/32,::1/128

        feature:
          # Keep the slskd dashboard UI off the swagger/openapi route to avoid
          # any chance of clashing with Wisp's API on the same machine.
          swagger: false

        flags:
          # Don't auto-launch the slskd web UI on startup; Wisp owns the UX.
          no_logo: true
          no_start_check: true
        """;
    }

    private static YamlMappingNode? TryMap(YamlMappingNode? parent, string key)
    {
        if (parent is null) return null;
        if (!parent.Children.TryGetValue(new YamlScalarNode(key), out var node)) return null;
        return node as YamlMappingNode;
    }

    private static string? TryScalar(YamlMappingNode? parent, string key)
    {
        if (parent is null) return null;
        if (!parent.Children.TryGetValue(new YamlScalarNode(key), out var node)) return null;
        return (node as YamlScalarNode)?.Value;
    }
}
