import { useEffect, useRef, useState } from 'react'
import { useDialogStore, type Pending, type PromptOptions } from './dialog'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'

// Native modal cancellation and focus handling; no global Escape handler can
// accidentally close a different dialog or Settings behind this one.
export function DialogHost() {
  const current = useDialogStore((s) => s.current)
  return current ? <DialogBody key={current.id} current={current} /> : null
}

function DialogBody({ current }: { current: Pending }) {
  const cancel = () => {
    if (current.kind === 'confirm') current.resolve(false)
    else if (current.kind === 'prompt' || current.kind === 'choice') current.resolve(null)
    else current.resolve()
  }
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (current.kind !== 'prompt') cancelRef.current?.focus()
  }, [current.kind])
  return (
    <Modal
      labelledBy="wisp-dialog-title"
      onClose={cancel}
      dismissOnBackdrop
      role={current.kind === 'alert' && current.opts.tone === 'error' ? 'alertdialog' : 'dialog'}
      className="w-[min(32rem,calc(100vw-2rem))] p-5"
    >
      <h2 id="wisp-dialog-title" className="ui-dialog-heading">
        {current.opts.title}
      </h2>
      {current.opts.message && (
        <p className="mt-3 whitespace-pre-line break-words text-sm text-[var(--color-muted)]">
          {current.opts.message}
        </p>
      )}
      {current.kind === 'confirm' && current.opts.body}
      {current.kind === 'prompt' ? (
        <PromptBody opts={current.opts} resolve={current.resolve} />
      ) : (
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button ref={cancelRef} onClick={cancel}>
            {current.kind === 'alert'
              ? (current.opts.confirmLabel ?? 'Close')
              : current.kind === 'confirm'
                ? (current.opts.cancelLabel ?? 'Cancel')
                : 'Cancel'}
          </Button>
          {current.kind === 'confirm' && (
            <Button
              variant={current.opts.danger ? 'danger' : 'primary'}
              onClick={() => current.resolve(true)}
            >
              {current.opts.confirmLabel ?? (current.opts.danger ? 'Delete' : 'Confirm')}
            </Button>
          )}
          {current.kind === 'choice' &&
            current.opts.choices.map((choice) => (
              <Button key={choice.value} onClick={() => current.resolve(choice.value)}>
                {choice.label}
              </Button>
            ))}
        </div>
      )}
    </Modal>
  )
}

function PromptBody({
  opts,
  resolve,
}: {
  opts: PromptOptions
  resolve: (value: string | null) => void
}) {
  const [value, setValue] = useState(opts.defaultValue ?? '')
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Please enter a value.')
      return
    }
    const message = opts.validate?.(trimmed)
    if (message) {
      setError(message)
      return
    }
    resolve(trimmed)
  }
  return (
    <>
      <input
        ref={input}
        aria-labelledby="wisp-dialog-title"
        aria-invalid={!!error}
        aria-describedby={error ? 'prompt-error' : undefined}
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          setError(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
        }}
        maxLength={opts.maxLength ?? 200}
        placeholder={opts.placeholder}
        className="mt-3 w-full rounded border border-[var(--ui-control-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
      />
      {error && (
        <p id="prompt-error" role="alert" className="mt-2 text-xs text-[var(--ui-danger)]">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={() => resolve(null)}>{opts.cancelLabel ?? 'Cancel'}</Button>
        <Button variant="primary" onClick={submit} disabled={!value.trim()}>
          {opts.confirmLabel ?? 'Save'}
        </Button>
      </div>
    </>
  )
}
