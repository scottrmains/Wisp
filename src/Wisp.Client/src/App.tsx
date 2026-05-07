import { useEffect, useState } from 'react'
import { bridge, bridgeAvailable } from './bridge'

type Health = { status: string; version: string; time: string }

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const [folderError, setFolderError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/health')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<Health>
      })
      .then((h) => {
        if (!cancelled) setHealth(h)
      })
      .catch((err: Error) => {
        if (!cancelled) setHealthError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const pickFolder = async () => {
    setFolderError(null)
    try {
      const result = await bridge.pickFolder()
      setFolder(result.path)
    } catch (err) {
      setFolderError((err as Error).message)
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-8 px-8 py-16">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">Wisp</h1>
        <p className="text-[var(--color-muted)]">Local DJ prep assistant — Phase 0 shell</p>
      </header>

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h2 className="mb-3 text-lg font-medium">API health</h2>
        {health ? (
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt className="text-[var(--color-muted)]">status</dt>
            <dd>{health.status}</dd>
            <dt className="text-[var(--color-muted)]">version</dt>
            <dd>{health.version}</dd>
            <dt className="text-[var(--color-muted)]">time</dt>
            <dd>{health.time}</dd>
          </dl>
        ) : healthError ? (
          <p className="text-red-400">Failed: {healthError}</p>
        ) : (
          <p className="text-[var(--color-muted)]">checking…</p>
        )}
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h2 className="mb-3 text-lg font-medium">Photino bridge</h2>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          {bridgeAvailable()
            ? 'Bridge available — running inside Photino.'
            : 'Bridge unavailable — open this app via Wisp.exe (Shell profile) to test the folder picker.'}
        </p>
        <button
          type="button"
          onClick={pickFolder}
          disabled={!bridgeAvailable()}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Pick folder
        </button>
        {folder && <p className="mt-3 break-all text-sm">Picked: {folder}</p>}
        {folderError && <p className="mt-3 text-sm text-red-400">{folderError}</p>}
      </section>
    </main>
  )
}

export default App
