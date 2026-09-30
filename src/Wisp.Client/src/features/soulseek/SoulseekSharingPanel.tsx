import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderPlus, RefreshCw, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { soulseek, type SharingSettings } from '../../api/soulseek'
import { bridge, bridgeAvailable } from '../../bridge'
import { transferPercent, transferState } from './transferState'

const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded border border-[var(--color-border)] px-3 py-2 text-xs hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40'
const input = 'min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm disabled:opacity-40'

export function SoulseekSharingPanel() {
  const settings = useQuery({ queryKey: ['soulseek-sharing'], queryFn: soulseek.sharing, retry: false })
  const shares = useQuery({ queryKey: ['soulseek-shares'], queryFn: soulseek.shares, refetchInterval: 5_000, retry: false })
  const scan = useQuery({ queryKey: ['soulseek-share-scan'], queryFn: soulseek.shareStatus, refetchInterval: 3_000, retry: false })
  const uploads = useQuery({ queryKey: ['soulseek-uploads'], queryFn: soulseek.uploads, refetchInterval: 3_000, retry: false })
  const qc = useQueryClient()
  const rescan = useMutation({ mutationFn: soulseek.rescanShares,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['soulseek-share-scan'] }); void qc.invalidateQueries({ queryKey: ['soulseek-shares'] }) } })
  const cancel = useMutation({ mutationFn: soulseek.cancelUpload, onSettled: () => qc.invalidateQueries({ queryKey: ['soulseek-uploads'] }) })
  const active = (uploads.data ?? []).filter(t => !transferState(t.state).finished)
  const shared = (shares.data ?? []).filter(s => !s.isExcluded)

  return <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 lg:px-7">
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
      <section>
        <h2 className="flex items-center gap-2 text-base font-semibold"><ShieldCheck size={18} />Your shared folders</h2>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-[var(--color-muted)]">Sharing is optional. Choose folders containing only files you intend to make public. WISP’s managed sharing excludes identity sidecars, common metadata and artwork files, incomplete downloads and private recording folders.</p>
        {settings.error && <p role="alert" className="mt-3 text-sm text-red-300">{settings.error.message}</p>}
        {settings.isLoading && <p className="mt-4 text-sm">Loading sharing settings…</p>}
        {settings.data && <SharingForm key={JSON.stringify(settings.data)} settings={settings.data.settings} canConfigure={settings.data.canConfigure} restartRequired={settings.data.restartRequired} />}
      </section>
      <section className="min-w-0 border-t border-[var(--color-border)] pt-5 xl:border-l xl:border-t-0 xl:pl-7 xl:pt-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Currently shared</h2>
          <button className={button} onClick={() => rescan.mutate()} disabled={rescan.isPending || !!scan.data?.scanning || !!scan.data?.scanPending || !shared.length}>
            <RefreshCw size={13} />Rescan shares</button>
        </div>
        {scan.data && <p role="status" className="mt-2 text-xs text-[var(--color-muted)]">
          {scan.data.scanning || scan.data.scanPending ? 'Scanning shared folders…' : scan.data.faulted ? 'Share scan failed. Try rescanning.' : scan.data.ready ? `${scan.data.files} files indexed for sharing` : 'Shares are not ready yet.'}
        </p>}
        {(shares.error || scan.error || rescan.error) && <p role="alert" className="mt-3 text-xs text-red-300">{rescan.error?.message ?? shares.error?.message ?? scan.error?.message}</p>}
        <ul className="mt-3 divide-y divide-[var(--color-border)]">
          {shared.map(s => <li key={s.id} className="py-3 text-xs"><p className="font-medium">{s.alias} <span className="font-normal text-[var(--color-muted)]">· {s.files ?? '—'} files</span></p><p className="mt-1 break-all text-[var(--color-muted)]">{s.localPath}</p></li>)}
        </ul>
        {!shared.length && !shares.isLoading && !shares.error && <p className="py-6 text-sm text-[var(--color-muted)]">No active shared folders. Saving a folder takes effect after restarting WISP.</p>}
      </section>
    </div>
    <section className="mt-8 border-t border-[var(--color-border)] pt-5">
      <h2 className="flex items-center gap-2 text-base font-semibold"><Upload size={17} />Active uploads <span className="text-sm font-normal text-[var(--color-muted)]">{active.length}</span></h2>
      {(uploads.error || cancel.error) && <p role="alert" className="mt-3 text-xs text-red-300">{cancel.error?.message ?? uploads.error?.message}</p>}
      {!active.length && !uploads.isLoading && !uploads.error && <p className="py-5 text-sm text-[var(--color-muted)]">Nobody is downloading from you right now. Sharing runs while WISP’s managed Soulseek connection is open.</p>}
      <ul className="mt-3 divide-y divide-[var(--color-border)]">
        {active.map(t => <li key={t.id} className="flex items-center gap-4 py-3 text-xs">
          <div className="min-w-0 flex-1"><p className="truncate" title={t.filename}>{t.filename.split(/[\\/]/).pop()}</p><p className="mt-1 text-[var(--color-muted)]">{t.username} · {t.state} · {transferPercent(t.percentage).toFixed(0)}% · {Math.round((t.averageSpeed ?? 0) / 1024)} KiB/s</p></div>
          <button className={button} disabled={cancel.isPending} onClick={() => cancel.mutate(t)} aria-label={`Cancel upload to ${t.username}`}>Cancel</button>
        </li>)}
      </ul>
    </section>
    <p className="mt-6 text-xs leading-relaxed text-[var(--color-muted)]">Only share files you have permission to distribute. Peer connectivity can depend on firewall and router port-forwarding settings.</p>
  </div>
}

function SharingForm({ settings, canConfigure, restartRequired }: { settings: SharingSettings; canConfigure: boolean; restartRequired: boolean }) {
  const [enabled, setEnabled] = useState(settings.enabled)
  const [folders, setFolders] = useState(settings.folders ?? [])
  const [slots, setSlots] = useState(settings.uploadSlots)
  const [speed, setSpeed] = useState(settings.uploadSpeedLimit)
  const [folder, setFolder] = useState('')
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()
  const save = useMutation({ mutationFn: () => soulseek.saveSharing({ enabled, folders, uploadSlots: slots, uploadSpeedLimit: speed }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['soulseek-sharing'] }) })
  const add = (path: string) => {
    const clean = path.trim()
    if (clean && !folders.some(f => f.toLowerCase() === clean.toLowerCase())) setFolders(old => [...old, clean])
    setFolder('')
  }
  const pick = async () => {
    setError(null)
    try { const result = await bridge.pickFolder(); if (result.path) add(result.path) }
    catch (e) { setError((e as Error).message) }
  }
  const valid = (!enabled || folders.length > 0) && slots >= 1 && slots <= 20 && speed >= 1 && speed <= 102400 && folders.length <= 20
  const changed = enabled !== settings.enabled || slots !== settings.uploadSlots || speed !== settings.uploadSpeedLimit || JSON.stringify(folders) !== JSON.stringify(settings.folders ?? [])
  return <div className="mt-5 space-y-4 text-xs">
    {!canConfigure && <p className="text-amber-200">Your external slskd manages sharing. Configure folders and limits there; WISP can still show its shares and uploads.</p>}
    <fieldset disabled={!canConfigure || save.isPending} className="space-y-4 disabled:opacity-50">
      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Enable sharing of selected folders</label>
      <ul className="divide-y divide-[var(--color-border)]">
        {folders.map(path => <li key={path} className="flex items-center gap-3 py-2"><span className="min-w-0 flex-1 break-all">{path}</span>
          <button className={button} onClick={() => setFolders(old => old.filter(p => p !== path))} aria-label={`Remove shared folder ${path}`}><Trash2 size={13} /></button></li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <input className={`${input} flex-1`} value={folder} onChange={e => setFolder(e.target.value)} aria-label="Folder to share" placeholder="Full path to a music folder" />
        <button className={button} disabled={!folder.trim() || folders.length >= 20} onClick={() => add(folder)}>Add folder</button>
        <button className={button} disabled={!bridgeAvailable() || folders.length >= 20} onClick={() => void pick()}><FolderPlus size={13} />Browse</button>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="space-y-1">Upload slots<input aria-label="Upload slots" className={`${input} block w-24`} type="number" min={1} max={20} value={slots} onChange={e => setSlots(Number(e.target.value))} /></label>
        <label className="space-y-1">Upload limit (KiB/s)<input aria-label="Upload speed limit" className={`${input} block w-32`} type="number" min={1} max={102400} value={speed} onChange={e => setSpeed(Number(e.target.value))} /></label>
      </div>
      <button disabled={!valid || !changed} onClick={() => save.mutate()} className={`${button} bg-[var(--color-accent)] text-white`}>{save.isPending ? 'Saving…' : 'Save sharing settings'}</button>
    </fieldset>
    <p className="leading-relaxed text-[var(--color-muted)]">Restart WISP to apply folder changes, upload limits or disable sharing. Saving leaves the running connection unchanged and does not interrupt downloads. Remove a folder here to stop sharing it on the next launch.</p>
    {restartRequired && <p role="status" className="text-amber-200">Sharing settings saved. Restart WISP to apply them.</p>}
    {(error || save.error) && <p role="alert" className="text-red-300">{error ?? save.error?.message}</p>}
  </div>
}
