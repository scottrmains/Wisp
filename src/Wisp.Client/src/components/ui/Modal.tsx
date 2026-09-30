import { useEffect, useRef, type HTMLAttributes, type ReactNode, type RefObject } from 'react'

// Native modal semantics plus deterministic Tab wrapping/focus restoration.
// Kept separate so existing specialised dialogs can adopt it without changing
// their mutations, validation or cancellation behaviour.
function useModalFocus(ref: RefObject<HTMLDialogElement | null>, modal: boolean) {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = ref.current!
    if (modal) dialog.showModal()
    else {
      dialog.show()
      dialog.querySelector<HTMLElement>('button, input')?.focus()
    }
    const wrapTab = (event: KeyboardEvent) => {
      if (!modal || event.key !== 'Tab' || !dialog.contains(document.activeElement)) return
      const targets = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ),
      ].filter((node) => node.getClientRects().length && !node.closest('[inert]'))
      const destination =
        event.shiftKey && document.activeElement === targets[0]
          ? targets.at(-1)
          : !event.shiftKey && document.activeElement === targets.at(-1)
            ? targets[0]
            : null
      if (destination) {
        event.preventDefault()
        destination.focus()
      }
    }
    dialog.addEventListener('keydown', wrapTab)
    return () => {
      dialog.removeEventListener('keydown', wrapTab)
      dialog.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [ref, modal])
}

interface Props extends Omit<HTMLAttributes<HTMLDialogElement>, 'title'> {
  labelledBy: string
  children: ReactNode
  onClose: () => void
  dismissOnBackdrop?: boolean
}

function DialogSurface({
  labelledBy,
  children,
  onClose,
  modal,
  dismissOnBackdrop = false,
  className = '',
  ...props
}: Props & { modal: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useModalFocus(ref, modal)
  useEffect(() => {
    if (modal) return
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        document.querySelector('dialog:modal')
      )
        return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [modal, onClose])
  return (
    <dialog
      {...props}
      ref={ref}
      aria-labelledby={labelledBy}
      className={`ui-dialog ${className}`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        props.onClick?.(event)
        if (!dismissOnBackdrop || event.target !== event.currentTarget) return
        const box = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          onClose()
      }}
      onKeyDown={(event) => {
        if (modal) event.stopPropagation()
      }}
    >
      {children}
    </dialog>
  )
}

export function Modal(props: Props) {
  return <DialogSurface {...props} modal />
}

/** Non-modal so Library selection and native/internal dragging stay usable. */
export function Drawer(props: Props) {
  return <DialogSurface {...props} modal={false} />
}
