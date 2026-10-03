using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;

namespace Wisp.Cloud.Persistence;

// Created only after bearer-token and delegated-scope validation. No email or
// client-supplied user ID can select an account.
public sealed record ValidatedIdentity(string Issuer, Guid TenantId, Guid ObjectId);
public sealed record AccountView(int ContractVersion, Guid UserId, string DisplayName, string State);
public sealed class AccountNotActiveException : Exception;

public sealed class AccountRepository(CloudDbContext db)
{
    public async Task<AccountView?> ReadAsync(ValidatedIdentity identity, CancellationToken ct)
    {
        var user = await Find(identity).Select(i => new { i.User.Id, i.User.State, i.User.Profile.DisplayName }).SingleOrDefaultAsync(ct);
        if (user is null) return null;
        if (user.State != AccountState.Active) throw new AccountNotActiveException();
        return new(1, user.Id, user.DisplayName, user.State.ToString());
    }
    public async Task<AccountView> ProvisionAsync(ValidatedIdentity identity, CancellationToken ct)
    {
        // PostgreSQL serializes first sign-ins for this exact trusted identity;
        // uniqueness is also enforced by the composite primary key. Hash
        // collisions merely serialize unrelated callers, never merge identities.
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes($"{identity.Issuer}|{identity.TenantId:D}|{identity.ObjectId:D}"));
        var key = System.Buffers.Binary.BinaryPrimitives.ReadInt64BigEndian(digest);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({key})", ct);
        var existing = await ReadAsync(identity, ct);
        if (existing is not null)
        {
            await transaction.CommitAsync(ct);
            return existing;
        }
        var user = new CloudUser { Id = Guid.NewGuid(), CreatedAt = DateTimeOffset.UtcNow };
        user.Profile = new() { UserId = user.Id };
        db.Users.Add(user);
        db.Identities.Add(new() { Issuer = identity.Issuer, TenantId = identity.TenantId, ObjectId = identity.ObjectId, UserId = user.Id });
        db.AccountAudits.Add(new() { Id = Guid.NewGuid(), UserId = user.Id, Event = "account.created", OccurredAt = user.CreatedAt });
        await db.SaveChangesAsync(ct);
        var result = View(user); // disabled/deleting/deleted are never resurrected
        await transaction.CommitAsync(ct);
        return result;
    }
    private IQueryable<AuthIdentity> Find(ValidatedIdentity identity) => db.Identities.AsNoTracking()
        .Where(i => i.Issuer == identity.Issuer && i.TenantId == identity.TenantId && i.ObjectId == identity.ObjectId);
    private static AccountView View(CloudUser user) => user.State == AccountState.Active
        ? new(1, user.Id, user.Profile.DisplayName, user.State.ToString()) : throw new AccountNotActiveException();
}
