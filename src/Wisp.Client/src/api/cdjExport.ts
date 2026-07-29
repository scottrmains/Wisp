import { apiPost } from './client'
import type { CdjExportPreflight, CdjExportResult } from './types'

export type CdjExportSource = 'mix-plan' | 'playlist'

function sourcePath(source: CdjExportSource, id: string) {
  return source === 'mix-plan' ? `/api/mix-plans/${id}` : `/api/playlists/${id}`
}

export const cdjExport = {
  preflight: (source: CdjExportSource, id: string, targetFolder: string) =>
    apiPost<CdjExportPreflight>(`${sourcePath(source, id)}/cdj-export/preflight`, { targetFolder }),
  export: (source: CdjExportSource, id: string, targetFolder: string, confirmReplaceExistingPioneerLibrary: boolean) =>
    apiPost<CdjExportResult>(`${sourcePath(source, id)}/export-to-cdj`, {
      targetFolder,
      confirmReplaceExistingPioneerLibrary,
    }),
}
