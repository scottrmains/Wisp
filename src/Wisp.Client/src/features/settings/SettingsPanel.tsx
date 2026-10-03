import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, X, FolderOpen, Link, AudioLines, Info, UserRound } from 'lucide-react'
import { apiDelete, apiGet, apiPost } from '../../api/client'
import { cleanup } from '../../api/cleanup'
import { transcoder } from '../../api/transcoder'
import type { SystemInfo } from '../../api/types'
import { bridge, bridgeAvailable } from '../../bridge'
import { WispLogo } from '../../components/WispLogo'
import { SoulseekDownloadFolderSettings } from './SoulseekDownloadFolderSettings'
import { AccountSettings } from './AccountSettings'
import { Modal } from '../../components/ui/Modal'
import { Button, IconButton } from '../../components/ui/Button'
import { SectionTabs } from '../../components/ui/SectionTabs'
import { StatusMessage } from '../../components/ui/StatusMessage'
import './settings.css'
import dmSansLicence from '@fontsource/dm-sans/LICENSE?url'
import barlowLicence from '@fontsource/barlow-condensed/LICENSE?url'

interface Props {
  onClose: () => void
}

export function SettingsPanel({ onClose }: Props) {
  const [section, setSection] = useState<'library' | 'connections' | 'audio' | 'account' | 'about'>('library')
  const sys = useQuery({
    queryKey: ['system'],
    queryFn: () => apiGet<SystemInfo>('/api/system'),
  })

  const audits = useQuery({
    queryKey: ['cleanup-audits-summary'],
    queryFn: () => cleanup.audits(undefined, 500),
  })

  return (
    <Modal
      labelledBy="wisp-settings-title"
      onClose={onClose}
      className="settings-dialog flex flex-col"
    >
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
        <h2 id="wisp-settings-title" className="ui-dialog-heading flex items-center gap-2">
          <WispLogo size={32} />
          WISP settings
        </h2>
        <IconButton onClick={onClose} label="Close settings" variant="quiet">
          <X aria-hidden="true" />
        </IconButton>
      </header>

      <div className="shrink-0 px-5">
        <SectionTabs
          label="Settings sections"
          active={section}
          onSelect={setSection}
          items={[
            { id: 'library', label: 'Library', icon: <FolderOpen /> },
            { id: 'connections', label: 'Connections', icon: <Link /> },
            { id: 'audio', label: 'Audio tools', icon: <AudioLines /> },
            { id: 'account', label: 'Account', icon: <UserRound /> },
            { id: 'about', label: 'About & diagnostics', icon: <Info /> },
          ]}
        />
      </div>
      <div className="settings-content min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {/* Keep forms mounted so category changes never discard credential drafts. */}
        <div hidden={section !== 'account'}>
          <AccountSettings active={section === 'account'} />
        </div>
        <div hidden={section !== 'about'}>
          <SettingsRequestStatus
            pending={sys.isPending}
            error={sys.error}
            retry={() => void sys.refetch()}
          />
          <SettingsRequestStatus
            pending={audits.isPending}
            error={audits.error}
            retry={() => void audits.refetch()}
          />
          <Section title="About">
            <Row label="Version">{sys.data?.version ?? '…'}</Row>
            <Row label="Environment">{sys.data?.environment ?? '…'}</Row>
            <Row label="Cleanup audit entries">{audits.data?.length ?? '…'}</Row>
            <Row label="Font licences">
              <span className="flex gap-3">
                <a className="underline" href={dmSansLicence} download="DM-Sans-LICENSE.txt">
                  DM Sans
                </a>
                <a
                  className="underline"
                  href={barlowLicence}
                  download="Barlow-Condensed-LICENSE.txt"
                >
                  Barlow Condensed
                </a>
              </span>
            </Row>
          </Section>

          <Section title="Data locations">
            <PathRow label="App data" path={sys.data?.appDataDir} />
            <PathRow label="Database" path={sys.data?.databasePath} />
            <PathRow label="Config" path={sys.data?.configPath} />
            <PathRow label="Logs" path={sys.data?.logsDir} />
          </Section>
        </div>
        <div hidden={section !== 'library'}>
          <p className="settings-intro">
            Keep downloaded tracks together with your music. Recording masters remain separate from
            the track library.
          </p>
          <Section title="Soulseek download folder">
            <SoulseekDownloadFolderSettings />
          </Section>
        </div>
        <div hidden={section !== 'connections'}>
          <p className="settings-intro">
            Connect sources for discovery and downloads. Test a saved connection to check it;
            configured does not mean connected.
          </p>
          <Section title="Spotify · artist releases">
            <SpotifySettings />
          </Section>

          <Section title="Discogs · vinyl and older releases">
            <DiscogsSettings />
          </Section>

          <Section title="YouTube · discovery and previews">
            <YouTubeSettings />
          </Section>

          <Section title="Soulseek · peer downloads">
            <SoulseekSettings />
          </Section>
        </div>
        <div hidden={section !== 'audio'}>
          <p className="settings-intro">
            FFmpeg powers conversion, mix exports and loudness analysis. Choose recording inputs on
            the Mixes recording desk.
          </p>
          <Section title="FFmpeg">
            <TranscoderSettings />
          </Section>
        </div>
      </div>

      <footer className="flex items-center justify-end border-t border-[var(--color-border)] px-5 py-3">
        <Button onClick={onClose}>Close</Button>
      </footer>
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <span className="text-[var(--color-muted)]">{label}</span>
      <span>{children}</span>
    </div>
  )
}

interface SpotifyStatus {
  isConfigured: boolean
  clientIdPreview: string | null
}

function SettingsRequestStatus({
  pending,
  error,
  retry,
}: {
  pending: boolean
  error: Error | null
  retry: () => void
}) {
  if (error)
    return (
      <StatusMessage tone="error">
        Settings could not load: {error.message}{' '}
        <Button small onClick={retry}>
          Retry
        </Button>
      </StatusMessage>
    )
  return pending ? <StatusMessage>Loading settings…</StatusMessage> : null
}

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
      <SettingsRequestStatus
        pending={status.isPending}
        error={status.error}
        retry={() => void status.refetch()}
      />
      {(save.error || remove.error) && (
        <StatusMessage tone="error">{save.error?.message ?? remove.error?.message}</StatusMessage>
      )}
      <fieldset
        disabled={!status.data || status.isError || save.isPending || remove.isPending}
        className="space-y-2"
      >
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
                onClick={() =>
                  bridgeAvailable() &&
                  void bridge.openExternal('https://developer.spotify.com/dashboard')
                }
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
              aria-label="Spotify Client ID"
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm font-mono"
            />
            <div className="flex gap-2">
              <input
                type={showSecret ? 'text' : 'password'}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Client Secret"
                aria-label="Spotify Client Secret"
                className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm font-mono"
              />
              <button
                onClick={() => setShowSecret((s) => !s)}
                aria-label={showSecret ? 'Hide Spotify secret' : 'Show Spotify secret'}
                aria-pressed={showSecret}
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
      </fieldset>
      {testResult && (
        <p
          className={`inline-flex items-center gap-1 text-xs ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {testResult.ok ? (
            <>
              <Check size={11} strokeWidth={2} /> Connection OK
            </>
          ) : (
            <>
              <X size={11} strokeWidth={2} /> {testResult.message}
            </>
          )}
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

interface SoulseekStatus {
  isConfigured: boolean
  url: string | null
  keyPreview: string | null
  downloadFolder: string | null
  hasUsername: boolean
  hasPassword: boolean
  username: string | null
  manageSlskd: boolean
}

function SoulseekSettings() {
  const qc = useQueryClient()
  const status = useQuery({
    queryKey: ['soulseek-status'],
    queryFn: () => apiGet<SoulseekStatus>('/api/settings/soulseek'),
  })
  const [url, setUrl] = useState('http://localhost:5030')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [manageSlskd, setManageSlskd] = useState(true)
  const hydrated = useRef(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null)

  // Hydrate the local form state from the persisted settings the first time they load.
  // We only fill what's safe to echo back (URL, username, manage toggle) — never the
  // saved password or API key, which the user has to retype to change.
  useEffect(() => {
    if (!status.data || hydrated.current) return
    hydrated.current = true
    if (status.data.url) setUrl(status.data.url)
    if (status.data.username) setUsername(status.data.username)
    setManageSlskd(status.data.manageSlskd)
  }, [status.data])

  const save = useMutation({
    mutationFn: () =>
      apiPost('/api/settings/soulseek', {
        url: url.trim(),
        apiKey,
        downloadFolder: status.data?.downloadFolder ?? null,
        username: username.trim() || null,
        // Sending null for password = "leave existing password unchanged"; sending a value = update it.
        password: password ? password : null,
        manageSlskd,
      }),
    onSuccess: () => {
      setApiKey('')
      setPassword('')
      setTestResult(null)
      qc.invalidateQueries({ queryKey: ['soulseek-status'] })
      qc.invalidateQueries({ queryKey: ['soulseek-download-folder'] })
    },
  })

  const remove = useMutation({
    mutationFn: () => apiDelete('/api/settings/soulseek'),
    onSuccess: () => {
      setTestResult(null)
      qc.invalidateQueries({ queryKey: ['soulseek-status'] })
      qc.invalidateQueries({ queryKey: ['soulseek-download-folder'] })
    },
  })

  const test = useMutation({
    mutationFn: async () => {
      try {
        await apiPost('/api/soulseek/test')
        return { ok: true } as const
      } catch (e) {
        return { ok: false, message: (e as Error).message } as const
      }
    },
    onSuccess: setTestResult,
  })

  return (
    <div className="space-y-2">
      <SettingsRequestStatus
        pending={status.isPending}
        error={status.error}
        retry={() => void status.refetch()}
      />
      {(save.error || remove.error) && (
        <StatusMessage tone="error">{save.error?.message ?? remove.error?.message}</StatusMessage>
      )}
      <fieldset
        disabled={!status.data || status.isError || save.isPending || remove.isPending}
        className="space-y-2"
      >
        {status.data?.isConfigured ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
              <span>
                <span className="text-[var(--color-muted)]">Configured at</span>
                <span className="ml-2 font-mono text-xs">{status.data.url}</span>
                {status.data.keyPreview && (
                  <span className="ml-2 font-mono text-xs text-[var(--color-muted)]">
                    {status.data.keyPreview}
                  </span>
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
          </div>
        ) : (
          <div className="space-y-2">
            {/* Manage toggle determines which fields are required below. Bundled-mode is the default. */}
            <label className="flex items-start gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs">
              <input
                type="checkbox"
                checked={manageSlskd}
                onChange={(e) => setManageSlskd(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-white">Manage slskd automatically</span>
                <span className="block mt-0.5 text-[var(--color-muted)]">
                  Wisp launches the bundled slskd as a child process when it starts and shuts it
                  down with the app. Defers automatically if you've already got slskd running on
                  port 5030.
                </span>
              </span>
            </label>

            {manageSlskd ? (
              // Bundled mode — only Soulseek username + password are required; URL + API key are auto-generated.
              <>
                <p className="text-xs text-[var(--color-muted)]">
                  Bundled slskd needs your Soulseek network login (the username + password you'd use
                  on Nicotine+ / slskd's web UI). WISP stores them in its local configuration; slskd
                  uses them to log in to the Soulseek network.
                </p>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Soulseek username"
                  aria-label="Soulseek username"
                  className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm font-mono"
                />
                <div className="flex gap-2">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Soulseek password"
                    aria-label="Soulseek password"
                    className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm font-mono"
                  />
                  <button
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide Soulseek password' : 'Show Soulseek password'}
                    aria-pressed={showPassword}
                    className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)]"
                  >
                    {showPassword ? 'hide' : 'show'}
                  </button>
                </div>
              </>
            ) : (
              // Manual mode — original Phase 11 contract: paste in a URL + API key for an externally-running slskd.
              <>
                <p className="text-xs text-[var(--color-muted)]">
                  Pointing Wisp at an{' '}
                  <button
                    onClick={() =>
                      bridgeAvailable() &&
                      void bridge.openExternal('https://github.com/slskd/slskd')
                    }
                    className="text-[var(--color-accent)] hover:underline"
                  >
                    slskd
                  </button>{' '}
                  you run yourself. Generate an API key in its <code>slskd.yml</code> and paste it
                  below.
                </p>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="slskd URL"
                  aria-label="slskd URL"
                  className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm font-mono"
                />
                <div className="flex gap-2">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="API key"
                    aria-label="slskd API key"
                    className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm font-mono"
                  />
                  <button
                    onClick={() => setShowKey((s) => !s)}
                    aria-label={showKey ? 'Hide slskd key' : 'Show slskd key'}
                    aria-pressed={showKey}
                    className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)]"
                  >
                    {showKey ? 'hide' : 'show'}
                  </button>
                </div>
              </>
            )}

            <button
              onClick={() => save.mutate()}
              disabled={
                save.isPending ||
                (manageSlskd ? !username.trim() || !password.trim() : !url.trim() || !apiKey.trim())
              }
              className="w-full rounded bg-[var(--color-accent)] px-2 py-1 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {save.isPending
                ? 'Saving…'
                : manageSlskd
                  ? 'Save and start bundled slskd'
                  : 'Save slskd connection'}
            </button>
          </div>
        )}
      </fieldset>
      {testResult && (
        <p className={`text-xs ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {testResult.ok ? (
            <span className="inline-flex items-center gap-1">
              <Check size={11} strokeWidth={2} /> Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <X size={11} strokeWidth={2} /> {testResult.message}
            </span>
          )}
        </p>
      )}
    </div>
  )
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
      <SettingsRequestStatus
        pending={status.isPending}
        error={status.error}
        retry={() => void status.refetch()}
      />
      {(save.error || remove.error) && (
        <StatusMessage tone="error">{save.error?.message ?? remove.error?.message}</StatusMessage>
      )}
      <fieldset
        disabled={!status.data || status.isError || save.isPending || remove.isPending}
        className="space-y-2"
      >
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
                aria-label={`${props.statusKey === 'discogs-status' ? 'Discogs' : 'YouTube'} ${props.tokenLabel}`}
                className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm font-mono"
              />
              <button
                onClick={() => setShow((s) => !s)}
                aria-label={`${show ? 'Hide' : 'Show'} ${props.statusKey === 'discogs-status' ? 'Discogs' : 'YouTube'} token`}
                aria-pressed={show}
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
      </fieldset>
      {testResult && (
        <p
          className={`inline-flex items-center gap-1 text-xs ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {testResult.ok ? (
            <>
              <Check size={11} strokeWidth={2} /> Connection OK
            </>
          ) : (
            <>
              <X size={11} strokeWidth={2} /> {testResult.message}
            </>
          )}
        </p>
      )}
    </div>
  )
}

/// Phase 23 — surfaces FFmpeg detection state and lets the user override the
/// path. Override + save persists into WispSettings.FfmpegPath; the transcoder
/// status is then re-queried so the row updates.
function TranscoderSettings() {
  const qc = useQueryClient()
  const status = useQuery({
    queryKey: ['transcoder-status'],
    queryFn: () => transcoder.status(),
  })
  const [override, setOverride] = useState('')

  const save = useMutation({
    mutationFn: (path: string | null) => apiPost('/api/settings/ffmpeg', { ffmpegPath: path }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transcoder-status'] })
      setOverride('')
    },
  })

  const stateLabel: React.ReactNode = !status.data ? (
    '…'
  ) : !status.data.isReady ? (
    <span className="inline-flex items-center gap-1">
      <AlertTriangle size={12} strokeWidth={2} /> FFmpeg not found
    </span>
  ) : status.data.bundled ? (
    <span className="inline-flex items-center gap-1">
      <Check size={12} strokeWidth={2} /> Detected · bundled
    </span>
  ) : (
    <span className="inline-flex items-center gap-1">
      <Check size={12} strokeWidth={2} /> Detected
    </span>
  )

  const stateClass = !status.data?.isReady ? 'text-amber-300' : 'text-emerald-300'

  return (
    <div className="space-y-2 text-sm">
      <SettingsRequestStatus
        pending={status.isPending}
        error={status.error}
        retry={() => void status.refetch()}
      />
      <Row label="Status">
        <span className={stateClass}>{stateLabel}</span>
      </Row>
      {status.data?.ffmpegPath && (
        <Row label="Path">
          <code
            className="truncate rounded bg-[var(--color-surface)] px-2 py-1 text-xs"
            title={status.data.ffmpegPath}
          >
            {status.data.ffmpegPath}
          </code>
        </Row>
      )}
      {!status.data?.isReady && (
        <p className="text-xs text-[var(--color-muted)]">
          The bundled <code>ffmpeg.exe</code> normally ships next to <code>Wisp.exe</code>. If it's
          missing, run <code>tools/get-ffmpeg.ps1</code> in the repo to fetch it, or paste a system
          FFmpeg path below.
        </p>
      )}
      <Row label="Override path">
        <div className="flex gap-2">
          <input
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            placeholder="C:\\path\\to\\ffmpeg.exe"
            aria-label="FFmpeg override path"
            className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs"
          />
          <button
            onClick={() => save.mutate(override.trim() ? override.trim() : null)}
            disabled={save.isPending || status.isPending || status.isError}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-white/5 disabled:opacity-40"
            title={override.trim() ? 'Save override path' : 'Clear override (use bundled / PATH)'}
          >
            {override.trim() ? 'Save' : 'Clear'}
          </button>
        </div>
      </Row>
      {save.isError && <StatusMessage tone="error">{(save.error as Error).message}</StatusMessage>}
    </div>
  )
}

function PathRow({ label, path }: { label: string; path: string | undefined }) {
  const [error, setError] = useState<string | null>(null)
  const open = () => {
    if (!path || !bridgeAvailable()) return
    setError(null)
    void bridge
      .openInExplorer(path)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'Could not open this location.'),
      )
  }
  return (
    <div className="settings-row settings-path">
      <span className="text-[var(--color-muted)]">{label}</span>
      <code className="truncate rounded bg-[var(--color-surface)] px-2 py-1 text-xs" title={path}>
        {path ?? '…'}
      </code>
      <Button
        small
        onClick={open}
        disabled={!path || !bridgeAvailable()}
        className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
        aria-label={`Open ${label} in Explorer`}
        tooltip={
          bridgeAvailable() ? 'Open in Explorer' : 'Open in Explorer requires the WISP desktop app'
        }
      >
        Open
      </Button>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
    </div>
  )
}
