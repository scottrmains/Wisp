using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Library;

public sealed record MusicAnalysisRequest(IReadOnlyList<Guid>? TrackIds, bool Bpm = true, bool Key = true, bool CompareExisting = false);
public sealed record MusicAnalysisRow(Guid TrackId, string Title, string Status = "queued", string? Message = null,
    decimal? ExistingBpm = null, string? ExistingKey = null, MusicAnalysis? Result = null, string? SourceHash = null,
    string? SourcePath = null, bool Cached = false, bool BpmRequested = false, bool KeyRequested = false);
public sealed record MusicAnalysisJob(Guid Id, string Status, IReadOnlyList<MusicAnalysisRow> Rows);
public sealed record StoredMusicAnalysis(string SourceHash, MusicAnalysis Result, DateTime AnalyzedAt,
    decimal? AppliedBpm = null, string? AppliedKey = null, DateTime? AppliedAt = null);
public sealed record MusicAnalysisApply(decimal? Bpm = null, string? Key = null);

/// One job at a time, survives page navigation (not process restart). Suggestions
/// persist on the track; bounded completed-job retention avoids an unbounded queue.
public sealed class MusicAnalysisJobs(IServiceScopeFactory scopes, IMusicAnalyzer analyzer, ILogger<MusicAnalysisJobs> log)
    : BackgroundService
{
    private sealed class Job(MusicAnalysisRequest request)
    {
        public Guid Id { get; } = Guid.NewGuid();
        public MusicAnalysisRequest Request { get; } = request;
        public string Status = "queued";
        public List<MusicAnalysisRow> Rows = [];
        public CancellationTokenSource Cancel { get; } = new();
    }
    private readonly object sync = new();
    private readonly Dictionary<Guid, Job> jobs = [];
    private readonly SemaphoreSlim ready = new(0);
    private Job? active;
    public bool Available => analyzer.IsAvailable;
    public MusicAnalysisJob? Active { get { lock (sync) return active is null ? null : Snapshot(active); } }
    private static MusicAnalysisJob Snapshot(Job job) => new(job.Id, job.Status, job.Rows.ToArray());
    public MusicAnalysisJob? Get(Guid id) { lock (sync) return jobs.TryGetValue(id, out var job) ? Snapshot(job) : null; }

    public MusicAnalysisJob? Start(MusicAnalysisRequest request, IReadOnlyList<Track> tracks)
    {
        lock (sync)
        {
            if (active is not null) return null;
            while (jobs.Count >= 8)
            {
                var oldest = jobs.First(); oldest.Value.Cancel.Dispose(); jobs.Remove(oldest.Key);
            }
            var job = new Job(request);
            job.Rows = tracks.Select(t => new MusicAnalysisRow(t.Id,
                $"{t.Artist}{(string.IsNullOrWhiteSpace(t.Artist) ? "" : " — ")}{t.Title ?? t.FileName}{(string.IsNullOrWhiteSpace(t.Version) ? "" : $" ({t.Version})")}" )).ToList();
            jobs.Add(job.Id, job); active = job; ready.Release();
            return Snapshot(job);
        }
    }
    public bool Cancel(Guid id)
    {
        lock (sync)
        {
            if (!jobs.TryGetValue(id, out var job)) return false;
            if (job.Status is "queued" or "running") { job.Status = "cancelling"; job.Cancel.Cancel(); }
            return true;
        }
    }
    public static StoredMusicAnalysis? Read(string? json)
    {
        try
        {
            var stored = json is null ? null : JsonSerializer.Deserialize<StoredMusicAnalysis>(json);
            return stored?.Result is { } result && !string.IsNullOrWhiteSpace(result.Engine) &&
                double.IsFinite(result.Seconds) && double.IsFinite(result.TempoStrength) && double.IsFinite(result.KeyStrength)
                ? stored : null;
        }
        catch (JsonException) { return null; }
    }
    public static async Task<string> Hash(string path, CancellationToken ct)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.Asynchronous);
        return Convert.ToHexString(await SHA256.HashDataAsync(stream, ct));
    }
    public static (decimal? Bpm, string? Key) Tags(string path)
    {
        // Fail closed when the container is unreadable: don't overwrite tags we couldn't inspect.
        using var media = TagLib.File.Create(path);
        return (media.Tag.BeatsPerMinute > 0 ? media.Tag.BeatsPerMinute : null,
            string.IsNullOrWhiteSpace(media.Tag.InitialKey) ? null : media.Tag.InitialKey);
    }
    public static bool HasBpm(decimal? value) => value > 0;
    public static bool HasKey(string? value) => !string.IsNullOrWhiteSpace(value);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await ready.WaitAsync(stoppingToken); }
            catch (OperationCanceledException) { break; }
            Job job;
            lock (sync) { job = active!; if (job.Status != "cancelling") job.Status = "running"; }
            using var cancel = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken, job.Cancel.Token);
            try
            {
                for (var index = 0; index < job.Rows.Count; index++)
                {
                    cancel.Token.ThrowIfCancellationRequested();
                    MusicAnalysisRow row;
                    lock (sync) { row = job.Rows[index] with { Status = "running" }; job.Rows[index] = row; }
                    try { row = await Analyze(row, job.Request, cancel.Token); }
                    catch (OperationCanceledException) { throw; }
                    catch (Exception ex)
                    {
                        log.LogWarning(ex, "Music analysis failed for {TrackId}", row.TrackId);
                        row = row with { Status = "failed", Message = ex is IOException ? ex.Message :
                            "Could not analyse this file. Check that it plays, close tag editors and retry." };
                    }
                    lock (sync) job.Rows[index] = row;
                }
                lock (sync) job.Status = job.Cancel.IsCancellationRequested ? "cancelled" : "completed";
            }
            catch (OperationCanceledException)
            {
                lock (sync)
                {
                    job.Status = "cancelled";
                    job.Rows = job.Rows.Select(r => r.Status is "queued" or "running" ? r with { Status = "cancelled" } : r).ToList();
                }
            }
            finally { lock (sync) active = null; }
        }
    }
    private async Task<MusicAnalysisRow> Analyze(MusicAnalysisRow row, MusicAnalysisRequest request, CancellationToken ct)
    {
        // Coordinates with rescan/relink/tagging/file operations; a single read-only
        // file lock also prevents external tag editors changing the audio mid-analysis.
        await LibraryFileGate.Instance.WaitAsync(ct);
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
            var track = await db.Tracks.FindAsync([row.TrackId], ct);
            if (track is null) return row with { Status = "skipped", Message = "Track was removed from WISP." };
            // If both requested DB fields already exist, no file access or DSP is needed.
            if (!request.CompareExisting && (!request.Bpm || HasBpm(track.Bpm)) && (!request.Key || HasKey(track.MusicalKey)))
                return row with { Status = "skipped", Message = "Requested values already exist.", ExistingBpm = track.Bpm, ExistingKey = track.MusicalKey };
            await using var source = new FileStream(track.FilePath, FileMode.Open, FileAccess.Read, FileShare.Read);
            var tags = Tags(track.FilePath);
            var existingBpm = HasBpm(track.Bpm) ? track.Bpm : tags.Bpm;
            var existingKey = HasKey(track.MusicalKey) ? track.MusicalKey : tags.Key;
            var bpm = request.Bpm && (request.CompareExisting || !HasBpm(existingBpm));
            var key = request.Key && (request.CompareExisting || !HasKey(existingKey));
            row = row with { ExistingBpm = existingBpm, ExistingKey = existingKey, BpmRequested = bpm, KeyRequested = key };
            if (!bpm && !key) return row with { Status = "skipped", Message = "Requested values already exist in file tags. Rescan to import them." };
            var hash = await Hash(track.FilePath, ct);
            var stored = Read(track.MusicAnalysisJson);
            var cached = stored?.SourceHash == hash && stored.Result.Engine == MusicFeatures.Engine &&
                (!bpm || stored.Result.Bpm is not null) && (!key || stored.Result.Key is not null);
            var result = cached ? stored!.Result : await analyzer.AnalyzeAsync(track.FilePath, bpm, key, ct);
            ct.ThrowIfCancellationRequested();
            if (!cached)
            {
                // Preserve independently cached fields for the exact same bytes/engine only.
                if (stored?.SourceHash == hash && stored.Result.Engine == result.Engine)
                    result = result with { Bpm = bpm ? result.Bpm : stored.Result.Bpm,
                        Key = key ? result.Key : stored.Result.Key, TempoStrength = bpm ? result.TempoStrength : stored.Result.TempoStrength,
                        KeyStrength = key ? result.KeyStrength : stored.Result.KeyStrength,
                        TempoUncertain = bpm ? result.TempoUncertain : stored.Result.TempoUncertain,
                        KeyUncertain = key ? result.KeyUncertain : stored.Result.KeyUncertain };
                var next = stored?.SourceHash == hash && stored.Result.Engine == result.Engine
                    ? stored with { Result = result, AnalyzedAt = DateTime.UtcNow }
                    : new StoredMusicAnalysis(hash, result, DateTime.UtcNow);
                track.MusicAnalysisJson = JsonSerializer.Serialize(next);
                await db.SaveChangesAsync(ct);
            }
            return row with { Status = "review", Result = result, SourceHash = hash, SourcePath = track.FilePath, Cached = cached,
                Message = "Experimental suggestion — review before applying." };
        }
        finally { LibraryFileGate.Instance.Release(); }
    }
}
