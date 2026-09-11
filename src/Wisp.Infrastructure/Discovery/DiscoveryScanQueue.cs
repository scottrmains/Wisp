using System.Threading.Channels;

namespace Wisp.Infrastructure.Discovery;

public class DiscoveryScanQueue(DiscoveryScanProgressBus progress)
{
    private readonly Channel<DiscoveryScanRequest> _channel = Channel.CreateUnbounded<DiscoveryScanRequest>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

    public ChannelReader<DiscoveryScanRequest> Reader => _channel.Reader;

    public ValueTask EnqueueAsync(DiscoveryScanRequest request, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!progress.TryQueue(request.SourceId)) return ValueTask.CompletedTask;
        // Unbounded channel is never closed; reserve and enqueue without a cancellation gap.
        if (!_channel.Writer.TryWrite(request)) throw new InvalidOperationException("Discovery queue is closed.");
        return ValueTask.CompletedTask;
    }
}
