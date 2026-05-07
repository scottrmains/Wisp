/**
 * JS ↔ .NET bridge over Photino's WebView2 message channel.
 *
 * .NET side: PhotinoHost.HandleMessage in Wisp.Api.
 * Wire: postMessage strings shaped { id, method, args } → response { id, result, error }.
 *
 * Photino exposes:
 *   window.external.sendMessage(string)
 *   window.external.receiveMessage(callback)
 *
 * In a normal browser (Vite dev outside Photino) the channel is absent and
 * `invoke` rejects — call `bridgeAvailable()` to feature-detect first.
 */

interface PhotinoExternal {
  sendMessage(message: string): void
  receiveMessage(callback: (message: string) => void): void
}

// `window.external` is typed as the legacy `External` interface in lib.dom.d.ts —
// we can't safely redeclare it, so we feature-detect and cast at the boundary.
function getExternal(): PhotinoExternal | undefined {
  const ext = (window as unknown as { external?: unknown }).external
  if (
    ext &&
    typeof (ext as PhotinoExternal).sendMessage === 'function' &&
    typeof (ext as PhotinoExternal).receiveMessage === 'function'
  ) {
    return ext as PhotinoExternal
  }
  return undefined
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

const pending = new Map<string, Pending>()
let initialized = false

function ensureInit(ext: PhotinoExternal) {
  if (initialized) return
  ext.receiveMessage((raw: string) => {
    try {
      const msg = JSON.parse(raw) as { id?: string; result?: unknown; error?: string }
      if (!msg.id) return
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error))
      else p.resolve(msg.result)
    } catch (err) {
      console.error('bridge: failed to parse incoming message', err, raw)
    }
  })
  initialized = true
}

export function bridgeAvailable(): boolean {
  return getExternal() !== undefined
}

export function invoke<T = unknown>(method: string, args?: unknown): Promise<T> {
  const ext = getExternal()
  if (!ext) {
    return Promise.reject(new Error('Bridge unavailable (running outside Photino)'))
  }
  ensureInit(ext)
  const id = crypto.randomUUID()
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    ext.sendMessage(JSON.stringify({ id, method, args }))
  })
}

export const bridge = {
  pickFolder: (initialPath?: string) =>
    invoke<{ path: string | null }>('pickFolder', { initialPath }),
  openInExplorer: (path: string) => invoke<{ ok: boolean }>('openInExplorer', { path }),
  openExternal: (url: string) => invoke<{ ok: boolean }>('openExternal', { url }),
  ping: () => invoke<{ pong: string }>('ping'),
}
