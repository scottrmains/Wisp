import { useEffect, useRef, useState } from 'react'
import { useDialogStore, type AlertOptions, type ConfirmOptions, type PromptOptions } from './dialog'

/// Renders the modal for whichever dialog is currently pending. Mounted once
/// at App root via main.tsx. Listens to the dialog store and routes to the
/// right body. Click-outside / Escape resolves with cancel; Enter inside the
/// confirm or prompt body resolves with confirm.
export function DialogHost() {
  const current = useDialogStore((s) => s.current)

  // Esc-to-cancel — bound globally while a dialog is open. Doesn't fire when
  // the user is mid-typing in a form field outside (ours captures inside).
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (current.kind === 'confirm') current.resolve(false)
        else if (current.kind === 'prompt') current.resolve(null)
        else current.resolve()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current])

  if (!current) return null

  const cancel = () => {
    if (current.kind === 'confirm') current.resolve(false)
    else if (current.kind === 'prompt') current.resolve(null)
    else current.resolve()
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 p-6"
      onClick={(e) => { if (e.target === e.currentTarget) cancel() }}
    >
      {current.kind === 'confirm' && <ConfirmBody opts={current.opts} resolve={current.resolve} />}
      {current.kind === 'prompt' && <PromptBody opts={current.opts} resolve={current.resolve} />}
      {current.kind === 'alert' && <AlertBody opts={current.opts} resolve={current.resolve} />}
    </div>
  )
}

function ConfirmBody({ opts, resolve }: { opts: ConfirmOptions; resolve: (v: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { cancelRef.current?.focus() }, [])

  return (
    <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-5 shadow-2xl">
      <h2 className="text-base font-semibold">{opts.title}</h2>
      {opts.message && (
        <p className="mt-2 text-sm whitespace-pre-line text-[var(--color-muted)]">{opts.message}</p>
      )}
      {opts.body}
      <div className="mt-5 flex justify-end gap-2">
        <button
          ref={cancelRef}
          onClick={() => resolve(false)}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-white"
        >
          {opts.cancelLabel ?? 'Cancel'}
        </button>
        <button
          onClick={() => resolve(true)}
          className={
            opts.danger
              ? 'rounded-md bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600'
              : 'rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white'
          }
        >
          {opts.confirmLabel ?? (opts.danger ? 'Delete' : 'Confirm')}
        </button>
      </div>
    </div>
  )
}

function PromptBody({ opts, resolve }: { opts: PromptOptions; resolve: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.defaultValue ?? '')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Required')
      return
    }
    if (opts.validate) {
      const v = opts.validate(trimmed)
      if (v) {
        setError(v)
        return
      }
    }
    resolve(trimmed)
  }

  return (
    <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-5 shadow-2xl">
      <h2 className="text-base font-semibold">{opts.title}</h2>
      {opts.message && (
        <p className="mt-1 text-xs text-[var(--color-muted)]">{opts.message}</p>
      )}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(null) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
        maxLength={opts.maxLength ?? 200}
        placeholder={opts.placeholder}
        className="mt-3 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:border-[var(--color-accent)] focus:outline-none"
      />
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={() => resolve(null)}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-white"
        >
          {opts.cancelLabel ?? 'Cancel'}
        </button>
        <button
          onClick={submit}
          disabled={!value.trim()}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {opts.confirmLabel ?? 'OK'}
        </button>
      </div>
    </div>
  )
}

function AlertBody({ opts, resolve }: { opts: AlertOptions; resolve: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { buttonRef.current?.focus() }, [])

  const isError = opts.tone === 'error'

  return (
    <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-5 shadow-2xl">
      <h2 className={`text-base font-semibold ${isError ? 'text-red-300' : ''}`}>{opts.title}</h2>
      <p className="mt-2 text-sm whitespace-pre-line text-[var(--color-muted)]">{opts.message}</p>
      <div className="mt-5 flex justify-end">
        <button
          ref={buttonRef}
          onClick={() => resolve()}
          onKeyDown={(e) => { if (e.key === 'Enter') resolve() }}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
        >
          {opts.confirmLabel ?? 'OK'}
        </button>
      </div>
    </div>
  )
}
