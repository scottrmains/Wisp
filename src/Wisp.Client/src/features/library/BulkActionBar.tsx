interface Props {
  count: number
  hasActivePlan: boolean
  onAddToMix: () => void
  onArchive: () => void
  onTag: () => void
  onAddToPlaylist: () => void
  onClear: () => void
}

/// Renders above the library table whenever multi-selection is active.
/// Hidden when only a single row is selected — single-row actions live in the
/// inspector + the right-click menu.
export function BulkActionBar({ count, hasActivePlan, onAddToMix, onArchive, onTag, onAddToPlaylist, onClear }: Props) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-accent)]/10 px-4 py-1.5 text-sm">
      <span className="font-medium tabular-nums text-white">
        {count} tracks selected
      </span>
      <span className="h-4 w-px bg-[var(--color-border)]" aria-hidden />
      <BarButton
        onClick={onAddToMix}
        disabled={!hasActivePlan}
        title={hasActivePlan ? 'Append all to the active mix plan' : 'Pick or create an active mix plan first'}
      >
        ＋ Add to mix
      </BarButton>
      <BarButton onClick={onArchive} title="Retire selection from the active library">
        📦 Archive
      </BarButton>
      <BarButton onClick={onTag} title="Apply a tag to every selected track">
        🏷 Tag…
      </BarButton>
      <BarButton onClick={onAddToPlaylist} title="Add the selection to a playlist (or create a new one)">
        🎶 Add to playlist…
      </BarButton>
      <button
        onClick={onClear}
        className="ml-auto text-xs text-[var(--color-muted)] hover:text-white"
        title="Clear selection (Esc)"
      >
        ✕ Clear
      </button>
    </div>
  )
}

function BarButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1 text-xs hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}
