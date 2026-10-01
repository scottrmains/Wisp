import type { ReactNode } from 'react'

/** Section navigation rather than an ARIA tab widget: page-specific workspaces
 * remain owned by their feature, with no shared mount/unmount or state policy.
 */
export function SectionTabs<T extends string>({
  label,
  items,
  active,
  onSelect,
}: {
  label: string
  items: readonly { id: T; label: string; icon?: ReactNode }[]
  active: T
  onSelect: (id: T) => void
}) {
  return (
    <nav aria-label={label} className="ui-tabs">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="ui-tab"
          aria-current={active === item.id ? 'page' : undefined}
          onClick={() => onSelect(item.id)}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </nav>
  )
}
