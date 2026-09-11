import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPut } from '../../api/client'
import { bridge, bridgeAvailable } from '../../bridge'

interface FolderSettings {
  downloadFolder: string | null
  effectiveDownloadFolder: string | null
  nextDownloadFolder: string
  suggestedMusicFolder: string | null
  manageSlskd: boolean
  restartRequired: boolean
}

const endpoint = '/api/settings/soulseek/download-folder'
const buttonClass = 'rounded border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-40'

export function SoulseekDownloadFolderSettings() {
  const [saved, setSaved] = useState(false)
  const settings = useQuery({ queryKey: ['soulseek-download-folder'], queryFn: () => apiGet<FolderSettings>(endpoint) })
  if (settings.isPending) return <p className="text-xs text-[var(--color-muted)]">Checking download location…</p>
  if (settings.isError) return <div role="alert" className="text-xs text-red-400">{settings.error.message} <button className={buttonClass} onClick={() => void settings.refetch()}>Retry</button></div>
  return <>
    <FolderForm key={`${settings.data.downloadFolder}:${settings.data.manageSlskd}`} settings={settings.data} onSaved={() => setSaved(true)} />
    {(saved || settings.data.restartRequired) && settings.data.manageSlskd && <p role="status" className="mt-2 text-xs text-amber-300">Destination saved. Restart WISP to apply it to future downloads.</p>}
  </>
}

function FolderForm({ settings, onSaved }: { settings: FolderSettings; onSaved: () => void }) {
  const qc = useQueryClient()
  const [folder, setFolder] = useState(settings.downloadFolder ?? '')
  const [pickerError, setPickerError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => apiPut<{ message: string }>(endpoint, { downloadFolder: folder.trim() || null }),
    onSuccess: async () => {
      onSaved()
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['soulseek-download-folder'] }),
        qc.invalidateQueries({ queryKey: ['soulseek-status'] }),
      ])
    },
  })
  const pickFolder = async () => {
    setPickerError(null)
    try {
      const result = await bridge.pickFolder()
      if (result.path) setFolder(result.path)
    } catch (error) { setPickerError((error as Error).message) }
  }

  return (
    <div className="space-y-3 text-xs">
      <p className="text-[var(--color-muted)]">Downloads from playlists and Soulseek searches use this folder and are automatically added to your WISP library. Choose your music folder to keep new downloads alongside your collection.</p>
      <dl className="space-y-2">
        <div><dt className="text-[var(--color-muted)]">Currently downloading to</dt><dd className="mt-1 break-all">{settings.effectiveDownloadFolder ?? 'Soulseek is not running or its folder is unavailable.'}</dd></div>
        {settings.manageSlskd && <div><dt className="text-[var(--color-muted)]">Saved destination · next launch</dt><dd className="mt-1 break-all">{settings.nextDownloadFolder}</dd></div>}
      </dl>
      {settings.manageSlskd ? <>
        <label className="block" htmlFor="soulseek-download-folder">Download folder</label>
        <div className="flex gap-2">
          <input id="soulseek-download-folder" value={folder} onChange={(e) => setFolder(e.target.value)}
            placeholder="Default WISP downloads folder" disabled={save.isPending}
            className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-2 focus:border-[var(--color-accent)] focus:outline-none" />
          <button onClick={() => void pickFolder()} disabled={!bridgeAvailable() || save.isPending} className={buttonClass}
            title={bridgeAvailable() ? 'Choose a download folder' : 'Folder picker is available in the desktop app; you can also type a path'}>Browse…</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {settings.suggestedMusicFolder && <button className={buttonClass} disabled={save.isPending} title={settings.suggestedMusicFolder}
            onClick={() => setFolder(settings.suggestedMusicFolder!)}>Use music folder</button>}
          <button className={buttonClass} disabled={save.isPending || !folder} onClick={() => setFolder('')}>Use default</button>
          <button className="ml-auto rounded bg-[var(--color-accent)] px-3 py-1.5 text-white disabled:opacity-40"
            disabled={save.isPending || folder.trim() === (settings.downloadFolder ?? '')} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save folder'}</button>
        </div>
        <p className="text-[var(--color-muted)]">Restart WISP after saving. Existing files stay where they are; downloaded subfolders are preserved. This does not move or reorganise your music.</p>
      </> : <p className="text-[var(--color-muted)]">Your external slskd controls this location. Change its downloads directory there; WISP reads the active folder automatically.</p>}
      {(save.isError || pickerError) && <p role="alert" className="text-red-400">{pickerError ?? save.error?.message}</p>}
    </div>
  )
}
