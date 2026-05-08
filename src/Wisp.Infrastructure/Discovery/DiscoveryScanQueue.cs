using System.Threading.Channels;

namespace Wisp.Infrastructure.Discovery;

public class DiscoveryScanQueue
{
    private readonly Channel<DiscoveryScanRequest> _channel = Channel.CreateUnbounded<DiscoveryScanRequest>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

    public ChannelReader<DiscoveryScanRequest> Reader => _channel.Reader;

    public ValueTask EnqueueAsync(DiscoveryScanRequest request, CancellationToken cancellationToken = default)
        => _channel.Writer.WriteAsync(request, cancellationToken);
}
