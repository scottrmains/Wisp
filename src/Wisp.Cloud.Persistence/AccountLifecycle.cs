using Microsoft.EntityFrameworkCore;

namespace Wisp.Cloud.Persistence;

// Internal service primitive only; no public state-change/admin/delete endpoint.
// Phase 4 must authorize actors and coordinate provider/data erasure before use.
public sealed class AccountLifecycle(CloudDbContext db)
{
    public async Task TransitionAsync(Guid userId, AccountState expected, AccountState next, CancellationToken ct)
    {
        var allowed = (expected, next) switch
        {
            (AccountState.Active, AccountState.Disabled or AccountState.Deleting) => true,
            (AccountState.Disabled, AccountState.Active or AccountState.Deleting) => true,
            (AccountState.Deleting, AccountState.Deleted) => true,
            _ => false,
        };
        if (!allowed) throw new InvalidOperationException("Invalid account state transition.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var affected = await db.Users.Where(u => u.Id == userId && u.State == expected)
            .ExecuteUpdateAsync(set => set.SetProperty(u => u.State, next), ct);
        if (affected != 1) throw new InvalidOperationException("Account state changed; review before retrying.");
        db.AccountAudits.Add(new()
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Event = "account." + next.ToString().ToLowerInvariant(),
            OccurredAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
}
