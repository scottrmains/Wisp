import type { ChainWarning } from './summary'
import { warningEmoji, warningShortLabel } from './summary'

interface Props {
  warnings: ChainWarning[]
  onPreview: () => void
  /// When set, surfaces a "suggest fillers" affordance (route suggester).
  /// Only meaningful when both bracketing cards are anchored — caller decides.
  onSuggest?: () => void
}

/// The slot between two chain cards. Shows any warnings stacked above the
/// preview button so the user sees problems without hovering. When the parent
/// passes `onSuggest` (i.e. both sides are anchors), also surfaces a small
/// "✨" route-suggester button.
export function TransitionGap({ warnings, onPreview, onSuggest }: Props) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-1 self-stretch px-1">
      {warnings.map((w) => (
        <span
          key={`${w.kind}-${w.fromId}-${w.toId}`}
          className="flex items-center gap-0.5 rounded border border-amber-500/40 bg-amber-500/15 px-1 py-0.5 text-[9px] font-semibold text-amber-200"
          title={w.message}
        >
          <span aria-hidden>{warningEmoji(w.kind)}</span>
          <span>{warningShortLabel(w.kind)}</span>
        </span>
      ))}
      <button
        onClick={onPreview}
        title="Preview transition"
        aria-label="Preview transition"
        className="text-[var(--color-muted)] hover:text-[var(--color-accent)]"
      >
        ▶
      </button>
      {onSuggest && (
        <button
          onClick={onSuggest}
          title="Suggest filler tracks between these anchors"
          aria-label="Suggest filler tracks"
          className="text-[var(--color-accent)] hover:text-white"
        >
          ✨
        </button>
      )}
    </div>
  )
}
