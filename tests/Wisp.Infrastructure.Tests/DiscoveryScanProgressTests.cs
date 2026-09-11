using Wisp.Infrastructure.Discovery;

namespace Wisp.Infrastructure.Tests;

public sealed class DiscoveryScanProgressTests
{
    [Theory]
    [InlineData(DiscoveryScanStatus.Completed)]
    [InlineData(DiscoveryScanStatus.Failed)]
    [InlineData(DiscoveryScanStatus.Cancelled)]
    public async Task Late_subscriber_receives_terminal_result_instead_of_waiting_forever(DiscoveryScanStatus status)
    {
        var bus = new DiscoveryScanProgressBus();
        var id = Guid.NewGuid();
        var result = new DiscoveryScanProgress(id, status, 12, 0, 0, status == DiscoveryScanStatus.Failed ? "Quota exceeded" : null);
        bus.Publish(result);
        bus.Complete(id);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        var received = new List<DiscoveryScanProgress>();
        await foreach (var p in bus.SubscribeAsync(id, timeout.Token)) received.Add(p);
        Assert.Equal(result, Assert.Single(received));
    }

    [Fact]
    public async Task Repeated_clicks_queue_once_and_a_new_run_replaces_the_old_result()
    {
        var bus = new DiscoveryScanProgressBus();
        var queue = new DiscoveryScanQueue(bus);
        var id = Guid.NewGuid();
        await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => queue.EnqueueAsync(new(id)).AsTask()));
        Assert.True(queue.Reader.TryRead(out var item));
        Assert.Equal(id, item!.SourceId);
        Assert.False(queue.Reader.TryRead(out _));
        bus.Publish(new(id, DiscoveryScanStatus.Completed, 12, 0, 0, null));
        bus.Complete(id);
        await queue.EnqueueAsync(new(id));
        Assert.Equal(DiscoveryScanStatus.Pending, bus.Latest(id)!.Status);
        Assert.True(queue.Reader.TryRead(out _));
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        await using var events = bus.SubscribeAsync(id, timeout.Token).GetAsyncEnumerator();
        Assert.True(await events.MoveNextAsync());
        Assert.Equal(DiscoveryScanStatus.Pending, events.Current.Status);
        bus.Publish(new(id, DiscoveryScanStatus.Running, 0, 0, 0, null));
        bus.Publish(new(id, DiscoveryScanStatus.Completed, 13, 1, 1, null));
        bus.Complete(id);
        Assert.True(await events.MoveNextAsync());
        Assert.Equal(DiscoveryScanStatus.Running, events.Current.Status);
        Assert.True(await events.MoveNextAsync());
        Assert.Equal(1, events.Current.NewItems);
        Assert.False(await events.MoveNextAsync());
    }
}
