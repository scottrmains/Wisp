using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Wisp.Cloud.Persistence;

public enum AccountState { Active, Disabled, Deleting, Deleted }

public sealed class CloudUser
{
    public Guid Id { get; set; }
    public AccountState State { get; set; } = AccountState.Active;
    public DateTimeOffset CreatedAt { get; set; }
    public PrivateProfile Profile { get; set; } = null!;
}
public sealed class PrivateProfile
{
    public Guid UserId { get; set; }
    public string DisplayName { get; set; } = "DJ";
    public CloudUser User { get; set; } = null!;
}
public sealed class AuthIdentity
{
    public string Issuer { get; set; } = "";
    public Guid TenantId { get; set; }
    public Guid ObjectId { get; set; }
    public Guid UserId { get; set; }
    public CloudUser User { get; set; } = null!;
}
public sealed class AccountAudit
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Event { get; set; } = "";
    public DateTimeOffset OccurredAt { get; set; }
}
public sealed class CloudDbContext(DbContextOptions<CloudDbContext> options) : DbContext(options)
{
    public DbSet<CloudUser> Users => Set<CloudUser>();
    public DbSet<PrivateProfile> Profiles => Set<PrivateProfile>();
    public DbSet<AuthIdentity> Identities => Set<AuthIdentity>();
    public DbSet<AccountAudit> AccountAudits => Set<AccountAudit>();
    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<CloudUser>(e =>
        {
            e.ToTable("users"); e.HasKey(u => u.Id);
            e.Property(u => u.State).HasConversion<string>().HasMaxLength(16);
        });
        model.Entity<PrivateProfile>(e =>
        {
            e.ToTable("private_profiles"); e.HasKey(p => p.UserId);
            e.Property(p => p.DisplayName).HasMaxLength(80);
            e.HasOne(p => p.User).WithOne(u => u.Profile).HasForeignKey<PrivateProfile>(p => p.UserId).OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<AuthIdentity>(e =>
        {
            e.ToTable("auth_identities"); e.HasKey(i => new { i.Issuer, i.TenantId, i.ObjectId });
            e.Property(i => i.Issuer).HasMaxLength(256);
            e.HasOne(i => i.User).WithMany().HasForeignKey(i => i.UserId).OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<AccountAudit>(e =>
        {
            e.ToTable("account_audits"); e.HasKey(a => a.Id);
            e.Property(a => a.Event).HasMaxLength(40);
            e.HasIndex(a => new { a.UserId, a.OccurredAt });
        });
    }
}
public sealed class CloudDesignTimeFactory : IDesignTimeDbContextFactory<CloudDbContext>
{
    public CloudDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("WISP_CLOUD_MIGRATION_CONNECTION")
            ?? throw new InvalidOperationException("Set the isolated cloud migration connection; never use the desktop database.");
        return new(new DbContextOptionsBuilder<CloudDbContext>().UseNpgsql(connection).Options);
    }
}
