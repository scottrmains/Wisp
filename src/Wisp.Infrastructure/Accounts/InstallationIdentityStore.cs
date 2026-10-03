using Wisp.Core.Accounts;

namespace Wisp.Infrastructure.Accounts;

// Lazy profile-scoped random ID, not a machine fingerprint or proof of identity.
// Atomic creation handles parallel hosts without touching library/settings data.
public sealed class InstallationIdentityStore(string path) : IInstallationIdentityStore
{
    public async Task<Guid> GetAsync(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        if (File.Exists(path)) return await ReadAsync(ct);
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        var id = Guid.NewGuid();
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllTextAsync(temporary, id.ToString("D"), ct);
            ct.ThrowIfCancellationRequested();
            try { File.Move(temporary, path, overwrite: false); }
            catch (IOException) when (File.Exists(path)) { return await ReadAsync(ct); }
            return id;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    private async Task<Guid> ReadAsync(CancellationToken ct)
    {
        if (new FileInfo(path).Length > 128)
            throw new InvalidDataException("The installation identity is invalid; it has not been replaced.");
        var value = await File.ReadAllTextAsync(path, ct);
        if (!Guid.TryParseExact(value.Trim(), "D", out var id) || id == Guid.Empty)
            throw new InvalidDataException("The installation identity is invalid; it has not been replaced.");
        return id;
    }
}
