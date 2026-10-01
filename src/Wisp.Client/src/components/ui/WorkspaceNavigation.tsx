import { useRef, type ReactNode } from 'react'
import { PanelLeft } from 'lucide-react'
import { useUiPrefs } from '../../state/uiPrefs'
import { IconButton } from './Button'
import type { WorkspaceNavigationKey } from '../../state/workspaceNavigation'

export function NavigationToggle({
  navigation,
  label,
}: {
  navigation: WorkspaceNavigationKey
  label: string
}) {
  const collapsed = useUiPrefs((s) => s.workspaceNavigation[navigation].collapsed)
  const update = useUiPrefs((s) => s.setWorkspaceNavigation)
  return (
    <IconButton
      label={`${collapsed ? 'Show' : 'Hide'} ${label}`}
      aria-expanded={!collapsed}
      aria-controls={`workspace-${navigation}`}
      onClick={() => update(navigation, { collapsed: !collapsed })}
    >
      <PanelLeft />
    </IconButton>
  )
}

/** Stable hidden presentation keeps selection/scan state outside the navigator. */
export function WorkspaceNavigation({
  navigation,
  label,
  children,
}: {
  navigation: WorkspaceNavigationKey
  label: string
  children: ReactNode
}) {
  const prefs = useUiPrefs((s) => s.workspaceNavigation[navigation])
  const update = useUiPrefs((s) => s.setWorkspaceNavigation)
  const drag = useRef<{ x: number; width: number } | null>(null)
  return (
    <aside
      id={`workspace-${navigation}`}
      aria-label={label}
      className="workspace-navigation"
      hidden={prefs.collapsed}
      style={{ width: prefs.width }}
    >
      <div className="workspace-navigation-content">{children}</div>
      <div
        role="separator"
        aria-label={`Resize ${label}`}
        aria-orientation="vertical"
        aria-controls={`workspace-${navigation}`}
        aria-valuemin={180}
        aria-valuemax={360}
        aria-valuenow={prefs.width}
        tabIndex={0}
        className="workspace-navigation-resize"
        data-ui-tooltip="Drag to resize · Arrow keys adjust · Home resets"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          drag.current = { x: e.clientX, width: prefs.width }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (drag.current)
            update(navigation, { width: drag.current.width + e.clientX - drag.current.x })
        }}
        onPointerUp={(e) => {
          drag.current = null
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId)
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onLostPointerCapture={() => {
          drag.current = null
        }}
        onKeyDown={(e) => {
          const width =
            e.key === 'ArrowLeft'
              ? prefs.width - 20
              : e.key === 'ArrowRight'
                ? prefs.width + 20
                : e.key === 'Home'
                  ? 240
                  : null
          if (width !== null) {
            e.preventDefault()
            e.stopPropagation()
            update(navigation, { width })
          }
        }}
      />
    </aside>
  )
}
