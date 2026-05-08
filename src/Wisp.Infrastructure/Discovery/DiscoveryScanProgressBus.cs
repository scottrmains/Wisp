using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Threading.Channels;

namespace Wisp.Infrastructure.Discovery;

public class DiscoveryScanProgressBus
{
    private readonly ConcurrentDictionary<Guid, ConcurrentBag<Channel<DiscoveryScanProgress>>> _subs = new();

    public void Publish(DiscoveryScanProgress progress)
    {
        if (!_subs.TryGetValue(progress.SourceId, out var bag)) return;
        foreach (var ch in bag) ch.Writer.TryWrite(progress);
    }

    public void Complete(Guid sourceId)
    {
        if (!_subs.TryRemove(sourceId, out var bag)) return;
        foreach (var ch in bag) ch.Writer.TryComplete();
    }

    public async IAsyncEnumerable<DiscoveryScanProgress> SubscribeAsync(
        Guid sourceId,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var channel = Channel.CreateUnbounded<DiscoveryScanProgress>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });

        var bag = _subs.GetOrAdd(sourceId, _ => new ConcurrentBag<Channel<DiscoveryScanProgress>>());
        bag.Add(channel);

        try
        {
            await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken))
                yield return item;
        }
        finally
        {
            channel.Writer.TryComplete();
        }
    }
}
