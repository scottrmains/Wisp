using System.Threading.Channels;

namespace Wisp.Infrastructure.Library;

public class ScanQueue
{
    private readonly Channel<ScanRequest> _channel = Channel.CreateUnbounded<ScanRequest>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

    public ChannelReader<ScanRequest> Reader => _channel.Reader;

    public ValueTask EnqueueAsync(ScanRequest request, CancellationToken cancellationToken = default)
        => _channel.Writer.WriteAsync(request, cancellationToken);
}
