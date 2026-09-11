import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useUiPrefs } from '../../state/uiPrefs'
import { prepHeight } from './librarySelection'

export function ResizablePrepPane({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; height: number } | null>(null)
  const [space, setSpace] = useState({ available: 700, reserved: 260 })
  const { available, reserved } = space
  const requested = useUiPrefs((s) => s.libraryPrepHeight)
  const setHeight = useUiPrefs((s) => s.setLibraryPrepHeight)
  const collapsed = useUiPrefs((s) => s.inspectorCollapsed)
  const height = prepHeight(requested, available, reserved)
  const max = prepHeight(100000, available, reserved)

  useEffect(() => {
    const parent = root.current?.parentElement
    if (!parent) return
    const measure = () => {
      const chrome = [...parent.children].filter((el) => el !== root.current
        && el.getAttribute('aria-label') !== 'Library track list' && getComputedStyle(el).position !== 'fixed')
        .reduce((sum, el) => sum + el.getBoundingClientRect().height, 0)
      const next = { available: parent.clientHeight, reserved: chrome + 120 }
      setSpace((old) => old.available === next.available && old.reserved === next.reserved ? old : next)
    }
    const observer = new ResizeObserver(measure)
    const observe = () => {
      observer.disconnect()
      observer.observe(parent)
      for (const child of parent.children) if (child !== root.current) observer.observe(child)
      measure()
    }
    observe()
    const mutation = new MutationObserver(observe)
    mutation.observe(parent, { childList: true })
    return () => { observer.disconnect(); mutation.disconnect() }
  }, [])

  return <div ref={root} className="flex shrink-0 flex-col overflow-hidden" style={{ height: collapsed ? 60 : height }}>
    <section id="library-prep" aria-label="Track preparation" className="min-h-0 flex-1 overflow-hidden">{children}</section>
    {!collapsed && <div role="separator" aria-label="Resize player and track list" aria-controls="library-prep" aria-orientation="horizontal"
      aria-valuemin={100} aria-valuemax={max} aria-valuenow={height} tabIndex={0}
      title="Drag to resize · Arrow keys adjust · Home gives more list space · Double-click resets"
      className="group flex h-3 shrink-0 touch-none cursor-row-resize items-center justify-center border-y border-[var(--color-border)] bg-[var(--color-bg)] hover:bg-[var(--color-accent)]/20 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
      onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); drag.current = { y: e.clientY, height }; e.currentTarget.setPointerCapture(e.pointerId) }}
      onPointerMove={(e) => { if (drag.current) setHeight(prepHeight(drag.current.height + e.clientY - drag.current.y, available, reserved)) }}
      onPointerUp={(e) => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }}
      onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
      onDoubleClick={() => setHeight(340)}
      onKeyDown={(e) => {
        e.stopPropagation()
        const next = e.key === 'ArrowUp' ? height - 20 : e.key === 'ArrowDown' ? height + 20 : e.key === 'Home' ? 100 : e.key === 'End' ? max : null
        if (next !== null) { e.preventDefault(); setHeight(prepHeight(next, available, reserved)) }
      }}>
      <span aria-hidden className="h-0.5 w-12 rounded bg-[var(--color-muted)] group-hover:bg-[var(--color-accent)]" />
    </div>}
  </div>
}
