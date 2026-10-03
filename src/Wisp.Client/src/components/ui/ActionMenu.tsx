import { useId, useRef, type RefObject, type ReactNode } from 'react'
import { IconButton } from './Button'

interface Props {
  label: string
  icon: ReactNode
  triggerRef?: RefObject<HTMLButtonElement | null>
  items: {
    label: string
    icon?: ReactNode
    danger?: boolean
    disabled?: boolean
    onSelect: () => void
  }[]
}

/** Native light-dismiss popover with menu keyboard behaviour and viewport bounds. */
export function ActionMenu({ label, icon, items, triggerRef }: Props) {
  const id = useId()
  const internalTrigger = useRef<HTMLButtonElement>(null)
  const trigger = triggerRef ?? internalTrigger
  const menu = useRef<HTMLDivElement>(null)
  const close = (restore = true) => {
    menu.current?.hidePopover()
    if (restore) trigger.current?.focus()
  }
  const open = () => {
    const element = menu.current!,
      anchor = trigger.current!.getBoundingClientRect()
    element.showPopover()
    const bounds = element.getBoundingClientRect()
    element.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - bounds.width - 8))}px`
    element.style.top = `${anchor.bottom + bounds.height + 8 > innerHeight ? Math.max(8, anchor.top - bounds.height - 4) : anchor.bottom + 4}px`
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }
  return (
    <>
      <IconButton
        ref={trigger}
        label={label}
        variant="quiet"
        aria-haspopup="menu"
        aria-controls={id}
        aria-expanded="false"
        onClick={() => (menu.current?.matches(':popover-open') ? close() : open())}
      >
        {icon}
      </IconButton>
      <div
        id={id}
        ref={menu}
        popover="auto"
        role="menu"
        aria-label={label}
        className="ui-menu"
        onToggle={(event) => {
          trigger.current?.setAttribute(
            'aria-expanded',
            event.newState === 'open' ? 'true' : 'false',
          )
        }}
        onKeyDown={(event) => {
          const buttons = [
            ...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
          ]
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            if (buttons.length)
              buttons[
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                      buttons.length
              ]?.focus()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close()
          } else if (event.key === 'Tab') requestAnimationFrame(() => close(false))
        }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            role="menuitem"
            tabIndex={-1}
            type="button"
            disabled={item.disabled}
            className={item.danger ? 'text-[var(--ui-danger)]' : ''}
            onClick={() => {
              close()
              item.onSelect()
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}
