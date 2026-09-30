using System.Diagnostics;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Wisp.Infrastructure.FileSystem;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;
using Wisp.Infrastructure.Tagging;
using Wisp.Infrastructure.Audio;

// Offline operator tool. No migrations, imports, removals or audio writes.
// Reports/backups must be outside the repository; --apply is explicit.
if (args.Length is < 3 or > 4 || (args.Length == 4 && args[3] != "--apply"))
    throw new ArgumentException("Usage: dotnet run --project tools/Wisp.LibraryRecovery -- <database> <music-root> <new-report-directory> [--apply]");
var database = Path.GetFullPath(args[0]);
var root = Path.GetFullPath(args[1]);
var reportDirectory = Path.GetFullPath(args[2]);
var apply = args.Length == 4;
if (!File.Exists(database) || !Directory.Exists(root)) throw new IOException("Database/music root not found.");
if (Directory.Exists(reportDirectory)) throw new IOException("Choose a new report directory; existing reports are never overwritten.");
if (apply && new[] { "Wisp", "MixedInKey" }.Any(name => Process.GetProcessesByName(name).Length != 0))
    throw new InvalidOperationException("Close WISP and Mixed In Key before applying recovery.");
Directory.CreateDirectory(reportDirectory);
var connectionString = new SqliteConnectionStringBuilder
    { DataSource = database, Mode = apply ? SqliteOpenMode.ReadWrite : SqliteOpenMode.ReadOnly, Pooling = false }.ToString();
await using var db = new WispDbContext(new DbContextOptionsBuilder<WispDbContext>().UseSqlite(connectionString).Options);
var all = await db.Tracks.ToListAsync();
var prefix = root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
var scoped = all.Where(t => t.FilePath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)).ToArray();
var files = new FileScanner().EnumerateAudioFiles(root).ToArray();
var portableIdentity = new PortableTrackIdentity(new AudioContentFingerprint(
    new Mp3Transcoder(NullLogger<Mp3Transcoder>.Instance, () => Environment.GetEnvironmentVariable("WISP_FFMPEG_PATH"))), new FileFingerprint());
var recovery = new TrackRenameRecoveryService(db, new FileFingerprint(), new MetadataReader(), NullLogger<TrackRenameRecoveryService>.Instance, portableIdentity);
var plan = await recovery.PlanAsync(all, scoped, files, CancellationToken.None);
var matchedIds = plan.Matches.Select(m => m.Track.Id).ToHashSet();
var report = new
{
    Database = database, Root = root, CreatedAt = DateTime.UtcNow,
    Matches = plan.Matches.Select(m => new { m.Track.Id, OldPath = m.Track.FilePath, NewPath = m.File.Path, m.File.Hash, m.Reason }),
    Ambiguous = plan.AmbiguousPaths,
    UnlinkedFiles = files.Where(p => !all.Any(t => string.Equals(t.FilePath, p, StringComparison.OrdinalIgnoreCase)
            || string.Equals(t.OriginalFilePath, p, StringComparison.OrdinalIgnoreCase)
            || string.Equals(t.NormalizedFilePath, p, StringComparison.OrdinalIgnoreCase)))
        .Select(p => new { Path = p, Metadata = new MetadataReader().Read(p) }),
    Unresolved = scoped.Where(t => !File.Exists(t.FilePath) && !matchedIds.Contains(t.Id))
        .Select(t => new { t.Id, t.FilePath, t.Artist, t.Title, t.Version, t.Duration, t.IsUnavailable })
};
await File.WriteAllTextAsync(Path.Combine(reportDirectory, "plan.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"{plan.Matches.Count} recoverable, {plan.AmbiguousPaths.Count} ambiguous candidate paths. Report: {reportDirectory}");
if (!apply) return;

// SQLite backup API produces a consistent snapshot, including any WAL contents.
await db.Database.OpenConnectionAsync();
var source = (SqliteConnection)db.Database.GetDbConnection();
await using (var backup = new SqliteConnection(new SqliteConnectionStringBuilder
    { DataSource = Path.Combine(reportDirectory, "wisp-before-recovery.db"), Pooling = false }.ToString()))
{
    await backup.OpenAsync();
    source.BackupDatabase(backup);
}
await using var transaction = await db.Database.BeginTransactionAsync();
foreach (var match in plan.Matches)
    if (!await recovery.ApplyAsync(match, CancellationToken.None))
        throw new IOException("A file changed during recovery; rolling back the entire batch. Close all tag-writing apps and retry.");
await transaction.CommitAsync();
Console.WriteLine($"Applied {plan.Matches.Count} links. Backup: {Path.Combine(reportDirectory, "wisp-before-recovery.db")}");
