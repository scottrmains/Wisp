import { apiGet, apiPost } from './client'
import type { CdjExportPreflight, CdjExportResult } from './types'

export type CdjExportSource = 'mix-plan' | 'playlist'

export interface CdjUsbDevice {
  deviceId: string
  rootPath: string
  label: string
  model: string
  sizeBytes: number
  freeBytes: number
  fileSystem: string
  partitionStyle: string
  partitionCount: number
  canExport: boolean
  compatibilityProblem: string | null
}

function sourcePath(source: CdjExportSource, id: string) {
  return source === 'mix-plan' ? `/api/mix-plans/${id}` : `/api/playlists/${id}`
}

export const cdjExport = {
  devices: (signal?: AbortSignal) => apiGet<CdjUsbDevice[]>('/api/cdj-export/devices', undefined, signal),
  preflight: (source: CdjExportSource, id: string, targetFolder: string, usbDeviceId: string) =>
    apiPost<CdjExportPreflight>(`${sourcePath(source, id)}/cdj-export/preflight`, { targetFolder, usbDeviceId }),
  export: (source: CdjExportSource, id: string, targetFolder: string, confirmReplaceExistingPioneerLibrary: boolean, usbDeviceId: string) =>
    apiPost<CdjExportResult>(`${sourcePath(source, id)}/export-to-cdj`, {
      targetFolder,
      confirmReplaceExistingPioneerLibrary,
      usbDeviceId,
    }),
}
