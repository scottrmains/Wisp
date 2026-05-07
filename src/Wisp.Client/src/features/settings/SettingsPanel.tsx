import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import { cleanup } from '../../api/cleanup'
import type { SystemInfo } from '../../api/types'
import { bridge, bridgeAvailable } from '../../bridge'

interface Props {
  onClose: () => void
}

export function SettingsPanel({ onClose }: Props) {
  const sys = useQuery({
    queryKey: ['system'],
    queryFn: () => apiGet<SystemInfo>('/api/system'),
  })

  const audits = useQuery({
    queryKey: ['cleanup-audits-summary'],
    queryFn: () => cleanup.audits(undefined, 500),
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-full w-full max-w-xl flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-base font-semibold">Settings</h2>
          <button onClick={onClose} className="text-xl leading-none text-[var(--color-muted)] hover:text-white">
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <Section title="About">
            <Row label="Version">{sys.data?.version ?? '…'}</Row>
            <Row label="Environment">{sys.data?.environment ?? '…'}</Row>
            <Row label="Cleanup audit entries">{audits.data?.length ?? '…'}</Row>
          </Section>

          <Section title="Data locations">
            <PathRow label="App data" path={sys.data?.appDataDir} />
            <PathRow label="Database" path={sys.data?.databasePath} />
            <PathRow label="Config" path={sys.data?.configPath} />
            <PathRow label="Logs" path={sys.data?.logsDir} />
          </Section>

          <Section title="Coming soon">
            <p className="text-xs text-[var(--color-muted)]">
              Recommendation weight overrides, default mix mode, FFmpeg path, audio device selection.
            </p>
          </Section>
        </div>

        <footer className="flex items-center justify-end border-t border-[var(--color-border)] px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-white/5"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] items-center gap-2 text-sm">
      <span className="text-[var(--color-muted)]">{label}</span>
      <span>{children}</span>
    </div>
  )
}

function PathRow({ label, path }: { label: string; path: string | undefined }) {
  const open = () => {
    if (!path || !bridgeAvailable()) return
    void bridge.openInExplorer(path).catch(() => {/* swallow — user sees nothing happens */})
  }
  return (
    <div className="grid grid-cols-[10rem_1fr_auto] items-center gap-2 text-sm">
      <span className="text-[var(--color-muted)]">{label}</span>
      <code className="truncate rounded bg-[var(--color-surface)] px-2 py-1 text-xs" title={path}>
        {path ?? '…'}
      </code>
      <button
        onClick={open}
        disabled={!path || !bridgeAvailable()}
        className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
        title={bridgeAvailable() ? 'Open in Explorer' : 'Open in Explorer (Photino only)'}
      >
        Open
      </button>
    </div>
  )
}
