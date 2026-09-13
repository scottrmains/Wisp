namespace Wisp.Infrastructure.Audio;

/// Prevent the short input test and long recorder from opening concurrent inputs.
public sealed class CaptureLease
{
    private int busy;
    public IDisposable Acquire()
    {
        if (Interlocked.CompareExchange(ref busy, 1, 0) != 0)
            throw new InvalidOperationException("Another recording or input test is active. Stop it first.");
        return new Release(this);
    }
    private sealed class Release(CaptureLease owner) : IDisposable
    {
        private int disposed;
        public void Dispose() { if (Interlocked.Exchange(ref disposed, 1) == 0) Interlocked.Exchange(ref owner.busy, 0); }
    }
}
