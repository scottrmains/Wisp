import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ContextMenuItem {
  /// Stable key (also used as the menu label fallback). Required.
  id: string
  label: string
  icon?: string
  /// Disabled items render greyed and with a tooltip explaining why.
  disabled?: boolean
  disabledReason?: string
  /// Visual separator above this item (creates a thin divider line).
  separator?: boolean
  onSelect: () => void
}

interface Props {
  items: ContextMenuItem[]
  /// Page-relative coordinates from the triggering contextmenu event.
  x: number
  y: number
  onClose: () => void
}

const MENU_W = 220
const ESTIMATED_ITEM_H = 28

/// Lightweight right-click menu. Renders at (x, y) with edge-aware repositioning so
/// it never falls off-screen. Click-outside or Esc dismisses. Click on a disabled
/// item stays open so the user can read the tooltip; click on an enabled item
/// fires `onSelect` then auto-closes.
export function RowContextMenu({ items, x, y, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [adjusted, setAdjusted] = useState({ x, y })

  // Edge-detect after first paint so the menu height is measurable.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let nx = x
    let ny = y
    if (nx + rect.width > vw - 4) nx = Math.max(4, vw - rect.width - 4)
    if (ny + rect.height > vh - 4) ny = Math.max(4, vh - rect.height - 4)
    setAdjusted({ x: nx, y: ny })
  }, [x, y, items.length])

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Listen on capture so we beat the row's own click handler if the user clicks outside.
    window.addEventListener('mousedown', onPointer, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: 'fixed',
        left: adjusted.x,
        top: adjusted.y,
        width: MENU_W,
        minHeight: items.length * ESTIMATED_ITEM_H,
      }}
      className="z-[60] overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 text-sm shadow-2xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.separator && <div className="my-1 border-t border-[var(--color-border)]/60" />}
          <button
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              item.onSelect()
              onClose()
            }}
            title={item.disabled ? item.disabledReason : undefined}
            className={[
              'flex w-full items-center gap-2 px-3 py-1.5 text-left',
              item.disabled
                ? 'cursor-not-allowed text-[var(--color-muted)]/40'
                : 'hover:bg-[var(--color-accent)]/20 hover:text-white',
            ].join(' ')}
          >
            <span className="w-4 text-center text-[var(--color-muted)]">{item.icon ?? ''}</span>
            <span>{item.label}</span>
          </button>
        </div>
      ))}
    </div>
  )
}
