import { useState } from 'react'
import { useMixPlans } from './useMixPlans'

export function PlanSwitcher() {
  const { plans, activePlanId, setActivePlanId, create, remove } = useMixPlans()
  const [open, setOpen] = useState(false)

  const active = plans.find((p) => p.id === activePlanId) ?? null

  const handleCreate = async () => {
    const name = window.prompt('Mix plan name', `Mix ${new Date().toLocaleDateString()}`)
    if (!name?.trim()) return
    await create.mutateAsync(name.trim())
    setOpen(false)
  }

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return
    await remove.mutateAsync(id)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:border-[var(--color-accent)]"
      >
        <span className="text-[var(--color-muted)]">Mix plan:</span>
        <span className="font-medium">{active ? active.name : 'None'}</span>
        <span className="text-[var(--color-muted)]">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
            <div className="max-h-64 overflow-y-auto">
              {plans.length === 0 && (
                <p className="px-3 py-3 text-xs text-[var(--color-muted)]">No mix plans yet.</p>
              )}
              {plans.map((p) => (
                <div
                  key={p.id}
                  className={[
                    'group flex items-center justify-between px-3 py-2 text-sm hover:bg-white/5',
                    p.id === activePlanId ? 'bg-white/5' : '',
                  ].join(' ')}
                >
                  <button
                    onClick={() => {
                      setActivePlanId(p.id)
                      setOpen(false)
                    }}
                    className="min-w-0 flex-1 truncate text-left"
                  >
                    {p.name}
                    <span className="ml-2 text-xs text-[var(--color-muted)]">{p.trackCount} tracks</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDelete(p.id, p.name)
                    }}
                    className="ml-2 text-xs text-[var(--color-muted)] opacity-0 hover:text-red-400 group-hover:opacity-100"
                    aria-label={`Delete ${p.name}`}
                  >
                    delete
                  </button>
                </div>
              ))}
            </div>
            <div className="border-t border-[var(--color-border)] p-1">
              <button
                onClick={handleCreate}
                className="w-full rounded px-3 py-2 text-left text-sm hover:bg-white/5"
              >
                + New mix plan
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
