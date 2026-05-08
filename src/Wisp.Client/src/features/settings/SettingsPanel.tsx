import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost } from '../../api/client'
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

          <Section title="Spotify (Artist Refresh source)">
            <SpotifySettings />
          </Section>

          <Section title="Discogs (Artist Refresh — best for old / vinyl-only releases)">
            <DiscogsSettings />
          </Section>

          <Section title="YouTube (audition layer for releases)">
            <YouTubeSettings />
          </Section>

          <Section title="Coming soon">
            <p className="text-xs text-[var(--color-muted)]">
              Recommendation weight overrides, default mix mode, FFmpeg path, audio device selection, MusicBrainz.
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

interface SpotifyStatus { isConfigured: boolean; clientIdPreview: string | null }

function SpotifySettings() {
  const qc = useQueryClient()
  const status = useQuery({
    queryKey: ['spotify-status'],
    queryFn: () => apiGet<SpotifyStatus>('/api/settings/spotify'),
  })
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null)

  const save = useMutation({
    mutationFn: () => apiPost('/api/settings/spotify', { clientId, clientSecret }),
    onSuccess: () => {
      setClientId('')
      setClientSecret('')
      setTestResult(null)
      qc.invalidateQueries({ queryKey: ['spotify-status'] })
    },
  })

  const remove = useMutation({
    mutationFn: () => apiDelete('/api/settings/spotify'),
    onSuccess: () => {
      setTestResult(null)
      qc.invalidateQueries({ queryKey: ['spotify-status'] })
    },
  })

  const test = useMutation({
    mutationFn: async () => {
      try {
        await apiPost('/api/spotify/test')
        return { ok: true } as const
      } catch (e) {
        return { ok: false, message: (e as Error).message } as const
      }
    },
    onSuccess: setTestResult,
  })

  return (
    <div className="space-y-2">
      {status.data?.isConfigured ? (
        <div className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
          <span>
            <span className="text-[var(--color-muted)]">Configured</span>
            {status.data.clientIdPreview && (
              <span className="ml-2 font-mono text-xs">{status.data.clientIdPreview}</span>
            )}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => test.mutate()}
              disabled={test.isPending}
              className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs hover:bg-white/5 disabled:opacity-40"
            >
              {test.isPending ? 'Testing…' : 'Test'}
            </button>
            <button
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="rounded border border-red-500/30 px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-[var(--color-muted)]">
            Create an app at{' '}
            <button
              onClick={() => bridgeAvailable() && void bridge.openExternal('https://developer.spotify.com/dashboard')}
              className="text-[var(--color-accent)] hover:underline"
            >
              developer.spotify.com/dashboard
            </button>{' '}
            and paste its Client ID + Secret. Stored in plain JSON in your AppData folder.
          </p>
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Client ID"
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm font-mono"
          />
          <div className="flex gap-2">
            <input
              type={showSecret ? 'text' : 'password'}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Client Secret"
              className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm font-mono"
            />
            <button
              onClick={() => setShowSecret((s) => !s)}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)]"
            >
              {showSecret ? 'hide' : 'show'}
            </button>
          </div>
          <button
            onClick={() => save.mutate()}
            disabled={!clientId.trim() || !clientSecret.trim() || save.isPending}
            className="w-full rounded bg-[var(--color-accent)] px-2 py-1 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {save.isPending ? 'Saving…' : 'Save credentials'}
          </button>
        </div>
      )}
      {testResult && (
        <p className={`text-xs ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {testResult.ok ? '✓ Connection OK' : `✗ ${testResult.message}`}
        </p>
      )}
    </div>
  )
}

function DiscogsSettings() {
  return (
    <SingleTokenSettings
      statusKey="discogs-status"
      statusUrl="/api/settings/discogs"
      saveUrl="/api/settings/discogs"
      deleteUrl="/api/settings/discogs"
      testUrl="/api/discogs/test"
      tokenLabel="Personal access token"
      tokenField="personalAccessToken"
      previewField="tokenPreview"
      docHref="https://www.discogs.com/settings/developers"
      docLabel="discogs.com/settings/developers"
      hint="Generate a personal access token under Developer settings — no OAuth flow needed. Stored in plain JSON in your AppData folder."
    />
  )
}

function YouTubeSettings() {
  return (
    <SingleTokenSettings
      statusKey="youtube-status"
      statusUrl="/api/settings/youtube"
      saveUrl="/api/settings/youtube"
      deleteUrl="/api/settings/youtube"
      testUrl="/api/youtube/test"
      tokenLabel="API key"
      tokenField="apiKey"
      previewField="keyPreview"
      docHref="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
      docLabel="Google Cloud Console (YouTube Data API v3)"
      hint="Free tier is 10,000 units/day. Wisp uses the cheap playlistItems.list path (1 unit per page of 50) for uploads, so a typical day's browsing won't exhaust the quota."
    />
  )
}

interface SingleTokenStatus {
  isConfigured: boolean
  [k: string]: string | boolean | null | undefined
}

function SingleTokenSettings(props: {
  statusKey: string
  statusUrl: string
  saveUrl: string
  deleteUrl: string
  testUrl: string
  tokenLabel: string
  tokenField: string
  previewField: string
  docHref: string
  docLabel: string
  hint: string
}) {
  const qc = useQueryClient()
  const status = useQuery({
    queryKey: [props.statusKey],
    queryFn: () => apiGet<SingleTokenStatus>(props.statusUrl),
  })
  const [token, setToken] = useState('')
  const [show, setShow] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null)

  const save = useMutation({
    mutationFn: () => apiPost(props.saveUrl, { [props.tokenField]: token }),
    onSuccess: () => {
      setToken('')
      setTestResult(null)
      qc.invalidateQueries({ queryKey: [props.statusKey] })
    },
  })

  const remove = useMutation({
    mutationFn: () => apiDelete(props.deleteUrl),
    onSuccess: () => {
      setTestResult(null)
      qc.invalidateQueries({ queryKey: [props.statusKey] })
    },
  })

  const test = useMutation({
    mutationFn: async () => {
      try {
        await apiPost(props.testUrl)
        return { ok: true } as const
      } catch (e) {
        return { ok: false, message: (e as Error).message } as const
      }
    },
    onSuccess: setTestResult,
  })

  const preview = status.data?.[props.previewField] as string | null | undefined

  return (
    <div className="space-y-2">
      {status.data?.isConfigured ? (
        <div className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
          <span>
            <span className="text-[var(--color-muted)]">Configured</span>
            {preview && <span className="ml-2 font-mono text-xs">{preview}</span>}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => test.mutate()}
              disabled={test.isPending}
              className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs hover:bg-white/5 disabled:opacity-40"
            >
              {test.isPending ? 'Testing…' : 'Test'}
            </button>
            <button
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="rounded border border-red-500/30 px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-[var(--color-muted)]">
            {props.hint} Get yours at{' '}
            <button
              onClick={() => bridgeAvailable() && void bridge.openExternal(props.docHref)}
              className="text-[var(--color-accent)] hover:underline"
            >
              {props.docLabel}
            </button>
            .
          </p>
          <div className="flex gap-2">
            <input
              type={show ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={props.tokenLabel}
              className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm font-mono"
            />
            <button
              onClick={() => setShow((s) => !s)}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)]"
            >
              {show ? 'hide' : 'show'}
            </button>
          </div>
          <button
            onClick={() => save.mutate()}
            disabled={!token.trim() || save.isPending}
            className="w-full rounded bg-[var(--color-accent)] px-2 py-1 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {save.isPending ? 'Saving…' : `Save ${props.tokenLabel.toLowerCase()}`}
          </button>
        </div>
      )}
      {testResult && (
        <p className={`text-xs ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {testResult.ok ? '✓ Connection OK' : `✗ ${testResult.message}`}
        </p>
      )}
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
