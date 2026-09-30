using Microsoft.EntityFrameworkCore;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Persistence;

namespace Wisp.Api.Soulseek;

/// The scan queue is process-local. Make interrupted imports explicitly retryable
/// on startup, without rescanning music or touching completed import receipts.
public sealed class SoulseekImportRecovery(IServiceScopeFactory scopes) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        var ids = db.SoulseekImportReceipts.Select(r => r.ScanId);
        var jobs = await db.ScanJobs.Where(j => ids.Contains(j.Id) &&
            (j.Status == ScanStatus.Pending || j.Status == ScanStatus.Running)).ToListAsync(ct);
        foreach (var job in jobs)
        {
            job.Status = ScanStatus.Failed;
            job.Error = "WISP closed before this import finished. Use Retry import.";
            job.CompletedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync(ct);
    }
    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
