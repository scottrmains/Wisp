using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Wisp.Api;

/// Wraps a Windows Job Object configured with KILL_ON_JOB_CLOSE.
/// Any process assigned via <see cref="Assign"/> will be terminated when this
/// process exits — gracefully via X-button, via Ctrl+C, via crash, doesn't matter.
/// The kernel cleans up the job when the last handle to it closes (i.e. when our
/// process dies and Windows reaps all handles).
[SupportedOSPlatform("windows")]
internal static class WindowsJobObject
{
    private static readonly Lock _lock = new();
    private static IntPtr _job = IntPtr.Zero;

    /// Add the given process to the kill-on-close job. Idempotent — safe to call
    /// multiple times; the job is created once on first use.
    public static void Assign(System.Diagnostics.Process process)
    {
        if (!OperatingSystem.IsWindows()) return;

        lock (_lock)
        {
            if (_job == IntPtr.Zero)
            {
                _job = CreateJobObject(IntPtr.Zero, null);
                if (_job == IntPtr.Zero)
                    throw new InvalidOperationException("CreateJobObject failed: " + Marshal.GetLastPInvokeError());

                var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION
                {
                    BasicLimitInformation = new JOBOBJECT_BASIC_LIMIT_INFORMATION
                    {
                        LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                    },
                };
                var size = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
                var ptr = Marshal.AllocHGlobal(size);
                try
                {
                    Marshal.StructureToPtr(info, ptr, fDeleteOld: false);
                    if (!SetInformationJobObject(_job, JobObjectInfoType.ExtendedLimitInformation, ptr, (uint)size))
                        throw new InvalidOperationException("SetInformationJobObject failed: " + Marshal.GetLastPInvokeError());
                }
                finally
                {
                    Marshal.FreeHGlobal(ptr);
                }
            }
        }

        if (!AssignProcessToJobObject(_job, process.Handle))
        {
            // Most likely cause: process already in another job and nesting isn't supported on this OS.
            // Don't throw — fall back to best-effort cleanup via Process.Kill(entireProcessTree).
            var err = Marshal.GetLastPInvokeError();
            if (err != 0) System.Diagnostics.Trace.TraceWarning($"AssignProcessToJobObject failed (err {err})");
        }
    }

    // ─── P/Invoke ──────────────────────────────────────────────────────

    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

    private enum JobObjectInfoType { ExtendedLimitInformation = 9 }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public long Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string? lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(
        IntPtr hJob, JobObjectInfoType infoType, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);
}
