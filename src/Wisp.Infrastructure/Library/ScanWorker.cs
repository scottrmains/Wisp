using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Wisp.Infrastructure.Library;

/// Single-reader worker — only one scan runs at a time. Future scans queue.
public class ScanWorker(
    ScanQueue queue,
    IServiceScopeFactory scopeFactory,
    ILogger<ScanWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        log.LogInformation("Scan worker started");

        await foreach (var request in queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var scanner = scope.ServiceProvider.GetRequiredService<LibraryScanner>();
                await scanner.RunAsync(request, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Scan worker errored on job {Id}", request.ScanJobId);
            }
        }

        log.LogInformation("Scan worker stopped");
    }
}
