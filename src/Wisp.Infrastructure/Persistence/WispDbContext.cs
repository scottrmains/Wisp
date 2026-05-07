using Microsoft.EntityFrameworkCore;
using Wisp.Core.MixPlans;
using Wisp.Core.Tracks;

namespace Wisp.Infrastructure.Persistence;

public class WispDbContext(DbContextOptions<WispDbContext> options) : DbContext(options)
{
    public DbSet<Track> Tracks => Set<Track>();
    public DbSet<ScanJob> ScanJobs => Set<ScanJob>();
    public DbSet<MixPlan> MixPlans => Set<MixPlan>();
    public DbSet<MixPlanTrack> MixPlanTracks => Set<MixPlanTrack>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        var track = b.Entity<Track>();
        track.HasKey(t => t.Id);
        track.Property(t => t.FilePath).IsRequired();
        track.Property(t => t.FileName).IsRequired();
        track.Property(t => t.FileHash).IsRequired();
        track.HasIndex(t => t.FilePath).IsUnique();
        track.HasIndex(t => t.FileHash);
        track.HasIndex(t => new { t.Artist, t.Title });
        track.Property(t => t.Bpm).HasPrecision(6, 2);
        // SQLite stores TimeSpan as ticks via EF default converter
        track.Property(t => t.Duration);

        var scan = b.Entity<ScanJob>();
        scan.HasKey(s => s.Id);
        scan.Property(s => s.FolderPath).IsRequired();
        scan.Property(s => s.Status).HasConversion<string>().HasMaxLength(20);

        var plan = b.Entity<MixPlan>();
        plan.HasKey(p => p.Id);
        plan.Property(p => p.Name).IsRequired().HasMaxLength(200);
        plan.HasMany(p => p.Tracks)
            .WithOne()
            .HasForeignKey(t => t.MixPlanId)
            .OnDelete(DeleteBehavior.Cascade);

        var mpt = b.Entity<MixPlanTrack>();
        mpt.HasKey(t => t.Id);
        mpt.HasIndex(t => new { t.MixPlanId, t.Order });
        mpt.HasOne(t => t.Track)
            .WithMany()
            .HasForeignKey(t => t.TrackId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
