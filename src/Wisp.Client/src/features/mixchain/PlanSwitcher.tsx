import { useState } from 'react'
import { confirmDialog, promptDialog } from '../../components/dialog'
import { useMixPlans } from './useMixPlans'

export function PlanSwitcher() {
  const { plans, activePlanId, setActivePlanId, create, remove } = useMixPlans()
  const [open, setOpen] = useState(false)

  const active = plans.find((p) => p.id === activePlanId) ?? null

  const handleCreate = async () => {
    const name = await promptDialog({
      title: 'New mix plan',
      defaultValue: `Mix ${new Date().toLocaleDateString()}`,
      placeholder: 'Plan name',
      confirmLabel: 'Create',
    })
    if (!name) return
    await create.mutateAsync(name)
    setOpen(false)
  }

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirmDialog({
      title: `Delete "${name}"?`,
      message: 'The mix plan and its track ordering will be removed. The tracks themselves stay in your library.',
      danger: true,
    })
    if (!ok) return
    await remove.mutateAsync(id)
  }

  /// Trigger a download via a transient anchor — works in both Photino and the browser.
  const exportPlan = (id: string, format: 'm3u' | 'csv' | 'json') => {
    const a = document.createElement('a')
    a.href = `/api/mix-plans/${id}/export?format=${format}`
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setOpen(false)
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

            {active && (
              <div className="border-t border-[var(--color-border)] p-1">
                <p className="px-3 pt-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  Export “{active.name}”
                </p>
                <div className="flex gap-1 p-1">
                  <ExportButton onClick={() => exportPlan(active.id, 'm3u')}>M3U</ExportButton>
                  <ExportButton onClick={() => exportPlan(active.id, 'csv')}>CSV</ExportButton>
                  <ExportButton onClick={() => exportPlan(active.id, 'json')}>JSON</ExportButton>
                </div>
              </div>
            )}

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

function ExportButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:bg-white/5 hover:text-white"
    >
      {children}
    </button>
  )
}
