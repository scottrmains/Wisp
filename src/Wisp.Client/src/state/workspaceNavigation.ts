export type WorkspaceNavigationKey = 'plans' | 'artists' | 'sources'
export type NavigationPrefs = Record<WorkspaceNavigationKey, { width: number; collapsed: boolean }>
const keys: WorkspaceNavigationKey[] = ['plans', 'artists', 'sources']

export function normalizeNavigation(value: unknown): NavigationPrefs {
  const saved = value && typeof value === 'object' ? (value as Partial<NavigationPrefs>) : {}
  return Object.fromEntries(
    keys.map((key) => [
      key,
      {
        width:
          typeof saved[key]?.width === 'number' && Number.isFinite(saved[key]?.width)
            ? Math.max(180, Math.min(360, Math.round(saved[key]!.width)))
            : 240,
        collapsed: typeof saved[key]?.collapsed === 'boolean' ? saved[key]!.collapsed : false,
      },
    ]),
  ) as NavigationPrefs
}
