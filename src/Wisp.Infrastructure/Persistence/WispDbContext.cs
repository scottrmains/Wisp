using Microsoft.EntityFrameworkCore;
using Wisp.Core.ArtistRefresh;
using Wisp.Core.Cleanup;
using Wisp.Core.Cues;
using Wisp.Core.Discovery;
using Wisp.Core.Feedback;
using Wisp.Core.MixPlans;
using Wisp.Core.Playlists;
using Wisp.Core.Tagging;
using Wisp.Core.Tracks;
using Wisp.Core.Wanted;

namespace Wisp.Infrastructure.Persistence;

public class WispDbContext(DbContextOptions<WispDbContext> options) : DbContext(options)
{
    public DbSet<Track> Tracks => Set<Track>();
    public DbSet<ScanJob> ScanJobs => Set<ScanJob>();
    public DbSet<MixPlan> MixPlans => Set<MixPlan>();
    public DbSet<MixPlanTrack> MixPlanTracks => Set<MixPlanTrack>();
    public DbSet<CuePoint> CuePoints => Set<CuePoint>();
    public DbSet<MetadataAuditLog> MetadataAuditLogs => Set<MetadataAuditLog>();
    public DbSet<ArtistProfile> ArtistProfiles => Set<ArtistProfile>();
    public DbSet<ExternalRelease> ExternalReleases => Set<ExternalRelease>();
    public DbSet<DiscoverySource> DiscoverySources => Set<DiscoverySource>();
    public DbSet<DiscoveredTrack> DiscoveredTracks => Set<DiscoveredTrack>();
    public DbSet<DigitalMatch> DigitalMatches => Set<DigitalMatch>();
    public DbSet<BlendRating> BlendRatings => Set<BlendRating>();
    public DbSet<TrackTag> TrackTags => Set<TrackTag>();
    public DbSet<Playlist> Playlists => Set<Playlist>();
    public DbSet<PlaylistTrack> PlaylistTracks => Set<PlaylistTrack>();
    public DbSet<WantedTrack> WantedTracks => Set<WantedTrack>();

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
        // Optional FK to Playlist for recommendation scoping. SetNull on delete so a
        // deleted playlist drops the scope rather than vanishing the entire mix plan.
        plan.HasOne<Playlist>()
            .WithMany()
            .HasForeignKey(p => p.RecommendationScopePlaylistId)
            .OnDelete(DeleteBehavior.SetNull);

        var mpt = b.Entity<MixPlanTrack>();
        mpt.HasKey(t => t.Id);
        mpt.HasIndex(t => new { t.MixPlanId, t.Order });
        mpt.HasOne(t => t.Track)
            .WithMany()
            .HasForeignKey(t => t.TrackId)
            .OnDelete(DeleteBehavior.Cascade);

        var cue = b.Entity<CuePoint>();
        cue.HasKey(c => c.Id);
        cue.Property(c => c.Type).HasConversion<string>().HasMaxLength(20);
        cue.Property(c => c.Label).HasMaxLength(120);
        cue.HasIndex(c => new { c.TrackId, c.TimeSeconds });
        cue.HasOne(c => c.Track)
            .WithMany()
            .HasForeignKey(c => c.TrackId)
            .OnDelete(DeleteBehavior.Cascade);

        var audit = b.Entity<MetadataAuditLog>();
        audit.HasKey(a => a.Id);
        audit.Property(a => a.Action).HasConversion<string>().HasMaxLength(20);
        audit.Property(a => a.Status).HasConversion<string>().HasMaxLength(20);
        audit.HasIndex(a => a.TrackId);
        audit.HasIndex(a => a.CreatedAt);
        // No FK to Track — keep audit history even if the track row is deleted.

        var artist = b.Entity<ArtistProfile>();
        artist.HasKey(a => a.Id);
        artist.Property(a => a.Name).IsRequired().HasMaxLength(200);
        artist.Property(a => a.NormalizedName).IsRequired().HasMaxLength(200);
        artist.HasIndex(a => a.NormalizedName).IsUnique();

        var release = b.Entity<ExternalRelease>();
        release.HasKey(r => r.Id);
        release.Property(r => r.Source).IsRequired().HasMaxLength(40);
        release.Property(r => r.ExternalId).IsRequired().HasMaxLength(100);
        release.Property(r => r.Title).IsRequired().HasMaxLength(400);
        release.Property(r => r.ReleaseType).HasConversion<string>().HasMaxLength(20);
        release.HasIndex(r => r.ArtistProfileId);
        release.HasIndex(r => new { r.Source, r.ExternalId }).IsUnique();
        release.HasOne(r => r.Artist)
            .WithMany()
            .HasForeignKey(r => r.ArtistProfileId)
            .OnDelete(DeleteBehavior.Cascade);

        var discoSrc = b.Entity<DiscoverySource>();
        discoSrc.HasKey(s => s.Id);
        discoSrc.Property(s => s.Name).IsRequired().HasMaxLength(200);
        discoSrc.Property(s => s.SourceType).HasConversion<string>().HasMaxLength(30);
        discoSrc.Property(s => s.SourceUrl).IsRequired();
        discoSrc.Property(s => s.ExternalSourceId).IsRequired().HasMaxLength(100);
        discoSrc.HasIndex(s => s.ExternalSourceId).IsUnique();

        var discoTrk = b.Entity<DiscoveredTrack>();
        discoTrk.HasKey(t => t.Id);
        discoTrk.Property(t => t.SourceVideoId).IsRequired().HasMaxLength(40);
        discoTrk.Property(t => t.RawTitle).IsRequired();
        discoTrk.Property(t => t.Status).HasConversion<string>().HasMaxLength(30);
        discoTrk.HasIndex(t => t.DiscoverySourceId);
        discoTrk.HasIndex(t => new { t.DiscoverySourceId, t.SourceVideoId }).IsUnique();
        discoTrk.HasOne(t => t.Source)
            .WithMany()
            .HasForeignKey(t => t.DiscoverySourceId)
            .OnDelete(DeleteBehavior.Cascade);

        var match = b.Entity<DigitalMatch>();
        match.HasKey(m => m.Id);
        match.Property(m => m.Source).IsRequired().HasMaxLength(40);
        match.Property(m => m.ExternalId).IsRequired().HasMaxLength(100);
        match.Property(m => m.Availability).HasConversion<string>().HasMaxLength(20);
        match.HasIndex(m => m.DiscoveredTrackId);
        match.HasIndex(m => new { m.DiscoveredTrackId, m.Source, m.ExternalId }).IsUnique();
        match.HasOne(m => m.DiscoveredTrack)
            .WithMany()
            .HasForeignKey(m => m.DiscoveredTrackId)
            .OnDelete(DeleteBehavior.Cascade);

        var blend = b.Entity<BlendRating>();
        blend.HasKey(r => r.Id);
        blend.Property(r => r.Rating).HasConversion<string>().HasMaxLength(10);
        blend.Property(r => r.ContextNotes).HasMaxLength(500);
        // Look up rating by transition pair quickly so the modal can preselect a previous score.
        blend.HasIndex(r => new { r.TrackAId, r.TrackBId });
        // No FK to Track — keep ratings if either track is removed (analytics value > referential cleanliness).

        // Track.IsArchived flag — index it so the default `WHERE IsArchived = 0` filter is fast.
        track.HasIndex(t => t.IsArchived);
        track.Property(t => t.ArchiveReason).HasConversion<string>().HasMaxLength(20);

        var tag = b.Entity<TrackTag>();
        tag.HasKey(t => t.Id);
        tag.Property(t => t.Name).IsRequired().HasMaxLength(60);
        tag.Property(t => t.Type).HasConversion<string>().HasMaxLength(10);
        // Same tag can't be applied twice to the same track. Case-insensitive collation
        // means "Warm-up" and "warm-up" collide on insert, which matches user intuition.
        tag.HasIndex(t => new { t.TrackId, t.Name }).IsUnique();
        tag.HasIndex(t => t.Name); // for library-wide tag listing + filter
        tag.HasOne(t => t.Track)
            .WithMany()
            .HasForeignKey(t => t.TrackId)
            .OnDelete(DeleteBehavior.Cascade);

        var playlist = b.Entity<Playlist>();
        playlist.HasKey(p => p.Id);
        playlist.Property(p => p.Name).IsRequired().HasMaxLength(200);
        playlist.HasMany(p => p.Tracks)
            .WithOne()
            .HasForeignKey(t => t.PlaylistId)
            .OnDelete(DeleteBehavior.Cascade);

        var wanted = b.Entity<WantedTrack>();
        wanted.HasKey(w => w.Id);
        wanted.Property(w => w.Source).HasConversion<string>().HasMaxLength(20);
        wanted.Property(w => w.Artist).IsRequired().HasMaxLength(200);
        wanted.Property(w => w.Title).IsRequired().HasMaxLength(400);
        wanted.Property(w => w.SourceVideoId).HasMaxLength(40);
        // Same artist + title can't be wanted twice. Idempotent POST relies on this.
        wanted.HasIndex(w => new { w.Artist, w.Title }).IsUnique();
        wanted.HasIndex(w => w.MatchedLocalTrackId);
        // Optional FK to the matched local track. SetNull on delete so removing the
        // local track demotes the wanted row back to "still wanted" rather than
        // vanishing the wishlist entry.
        wanted.HasOne(w => w.MatchedLocalTrack)
            .WithMany()
            .HasForeignKey(w => w.MatchedLocalTrackId)
            .OnDelete(DeleteBehavior.SetNull);

        var playlistTrack = b.Entity<PlaylistTrack>();
        playlistTrack.HasKey(t => t.Id);
        // Same track can't appear twice in the same playlist — adds become idempotent.
        playlistTrack.HasIndex(t => new { t.PlaylistId, t.TrackId }).IsUnique();
        playlistTrack.HasIndex(t => t.TrackId); // for "which playlists is this track in?" lookups
        playlistTrack.HasOne(t => t.Track)
            .WithMany()
            .HasForeignKey(t => t.TrackId)
            // Removing a track from the library also removes it from any playlists.
            .OnDelete(DeleteBehavior.Cascade);
    }
}
