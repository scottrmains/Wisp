namespace Wisp.Infrastructure.Audio;

/// Exclude concurrent input capture and heavy mix import/export disk work.
public sealed class CaptureLease
{
    private int busy;
    public IDisposable Acquire()
    {
        if (Interlocked.CompareExchange(ref busy, 1, 0) != 0)
                throw new InvalidOperationException("Another recording, input test, mix import or mix export is active. Finish or cancel it first.");
        return new Release(this);
    }
    private sealed class Release(CaptureLease owner) : IDisposable
    {
        private int disposed;
        public void Dispose() { if (Interlocked.Exchange(ref disposed, 1) == 0) Interlocked.Exchange(ref owner.busy, 0); }
    }
}
