interface Props {
  fade: number
  onChange: (next: number) => void
}

export function Crossfader({ fade, onChange }: Props) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
        <span>Deck A</span>
        <span>Crossfader</span>
        <span>Deck B</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={fade}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
        aria-label="Crossfader"
      />
      <div className="mt-1 flex justify-between text-[10px] text-[var(--color-muted)]">
        <span>{Math.round((1 - fade) * 100)}%</span>
        <button
          onClick={() => onChange(0.5)}
          className="hover:text-white"
          title="Centre"
        >
          centre
        </button>
        <span>{Math.round(fade * 100)}%</span>
      </div>
    </div>
  )
}
