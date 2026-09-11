using System.Runtime.CompilerServices;
using System.Threading.Channels;

namespace Wisp.Infrastructure.Discovery;

public class DiscoveryScanProgressBus
{
    private readonly Lock _gate = new();
    private readonly Dictionary<Guid, DiscoveryScanProgress> _latest = new();
    private readonly Dictionary<Guid, HashSet<Channel<DiscoveryScanProgress>>> _subs = new();

    public DiscoveryScanProgress? Latest(Guid sourceId)
    {
        lock (_gate) return _latest.GetValueOrDefault(sourceId);
    }

    public bool TryQueue(Guid sourceId)
    {
        lock (_gate)
        {
            if (_latest.TryGetValue(sourceId, out var current) && current.Status is DiscoveryScanStatus.Pending or DiscoveryScanStatus.Running)
                return false;
            Publish(new DiscoveryScanProgress(sourceId, DiscoveryScanStatus.Pending, 0, 0, 0, null));
            return true;
        }
    }

    public void Publish(DiscoveryScanProgress progress)
    {
        lock (_gate)
        {
            _latest[progress.SourceId] = progress;
            if (_subs.TryGetValue(progress.SourceId, out var subs))
                foreach (var channel in subs) channel.Writer.TryWrite(progress);
        }
    }

    public void Complete(Guid sourceId)
    {
        lock (_gate)
        {
            if (_subs.Remove(sourceId, out var subs))
                foreach (var channel in subs) channel.Writer.TryComplete();
        }
    }

    public async IAsyncEnumerable<DiscoveryScanProgress> SubscribeAsync(
        Guid sourceId,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var channel = Channel.CreateUnbounded<DiscoveryScanProgress>(
            new UnboundedChannelOptions { SingleReader = true });

        // Subscribe and replay under the same lock as Publish: no missed fast completion.
        lock (_gate)
        {
            if (_latest.TryGetValue(sourceId, out var latest)) channel.Writer.TryWrite(latest);
            if (latest?.Status is DiscoveryScanStatus.Completed or DiscoveryScanStatus.Failed or DiscoveryScanStatus.Cancelled)
                channel.Writer.TryComplete();
            else
            {
                if (!_subs.TryGetValue(sourceId, out var subs)) _subs[sourceId] = subs = new();
                subs.Add(channel);
            }
        }

        try
        {
            await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken))
                yield return item;
        }
        finally
        {
            lock (_gate)
            {
                if (_subs.TryGetValue(sourceId, out var subs))
                {
                    subs.Remove(channel);
                    if (subs.Count == 0) _subs.Remove(sourceId);
                }
                channel.Writer.TryComplete();
            }
        }
    }
}
