using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Threading.Channels;

namespace Wisp.Infrastructure.Library;

/// In-memory pub/sub: scan workers publish progress, SSE endpoints subscribe per scanJobId.
/// Single-process by design — Wisp is local-first; no Redis/etc.
public class ScanProgressBus
{
    private readonly ConcurrentDictionary<Guid, ConcurrentBag<Channel<ScanProgress>>> _subs = new();

    public void Publish(ScanProgress progress)
    {
        if (!_subs.TryGetValue(progress.ScanJobId, out var bag)) return;
        foreach (var ch in bag)
            ch.Writer.TryWrite(progress);
    }

    public void Complete(Guid scanJobId)
    {
        if (!_subs.TryRemove(scanJobId, out var bag)) return;
        foreach (var ch in bag)
            ch.Writer.TryComplete();
    }

    public async IAsyncEnumerable<ScanProgress> SubscribeAsync(
        Guid scanJobId,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var channel = Channel.CreateUnbounded<ScanProgress>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });

        var bag = _subs.GetOrAdd(scanJobId, _ => new ConcurrentBag<Channel<ScanProgress>>());
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
