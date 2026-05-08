using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Wisp.Infrastructure.Discovery;

public class DiscoveryScanWorker(
    DiscoveryScanQueue queue,
    IServiceScopeFactory scopeFactory,
    ILogger<DiscoveryScanWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        log.LogInformation("Discovery scan worker started");

        await foreach (var request in queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var scanner = scope.ServiceProvider.GetRequiredService<DiscoveryScanner>();
                await scanner.RunAsync(request, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Discovery scan worker errored on source {Id}", request.SourceId);
            }
        }
    }
}
