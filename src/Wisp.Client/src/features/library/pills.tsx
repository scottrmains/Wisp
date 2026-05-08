import type { CSSProperties } from 'react'

interface KeyPillProps {
  musicalKey: string | null
}

/// Camelot-wheel coloured pill. Colour is derived from the wheel position so adjacent
/// keys read as adjacent colours. A/B share a hue; A is slightly desaturated (minor),
/// B is more saturated (major). Returns a muted dash when no key is set.
export function KeyPill({ musicalKey }: KeyPillProps) {
  if (!musicalKey) return <span className="text-[var(--color-muted)]">—</span>
  const parsed = parseCamelot(musicalKey)
  const style: CSSProperties = parsed
    ? camelotStyle(parsed.n, parsed.major)
    : { background: 'var(--color-bg)', color: 'var(--color-muted)' }
  return (
    <span
      className="inline-flex h-5 min-w-[2.25rem] items-center justify-center rounded px-1.5 text-[11px] font-semibold tabular-nums"
      style={style}
    >
      {musicalKey}
    </span>
  )
}

interface EnergyPillProps {
  energy: number | null
}

/// Energy pill: a small coloured dot (cool→warm gradient) + the number.
/// Null energy gets a muted dash.
export function EnergyPill({ energy }: EnergyPillProps) {
  if (energy === null) return <span className="text-[var(--color-muted)]">—</span>
  return (
    <span className="inline-flex items-center gap-1 text-[11px] tabular-nums">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: energyColor(energy) }}
      />
      <span>{energy}</span>
    </span>
  )
}

interface BpmPillProps {
  bpm: number | null
}

/// Subtle BPM display — no colour, just tabular-numbers in a soft pill so the
/// number stays the visual anchor.
export function BpmPill({ bpm }: BpmPillProps) {
  if (bpm === null) return <span className="text-[var(--color-muted)]">—</span>
  return (
    <span className="inline-flex h-5 min-w-[2.25rem] items-center justify-center rounded bg-[var(--color-bg)] px-1.5 text-[11px] tabular-nums">
      {bpm.toFixed(bpm % 1 === 0 ? 0 : 1)}
    </span>
  )
}

function parseCamelot(code: string): { n: number; major: boolean } | null {
  const m = /^(\d{1,2})([AB])$/i.exec(code.trim())
  if (!m) return null
  const n = Number(m[1])
  if (n < 1 || n > 12) return null
  return { n, major: m[2].toUpperCase() === 'B' }
}

function camelotStyle(n: number, major: boolean): CSSProperties {
  // 12 hues spaced around the colour wheel, anchored so 8B (the canonical
  // "easy" key in DJ software wheels) lands on a friendly green.
  const hue = ((n - 1) * 30) % 360
  const sat = major ? 70 : 55      // B/major slightly more saturated than A/minor
  const lightBg = major ? 28 : 22  // dark backgrounds in either case (we're on a dark UI)
  const lightFg = 88
  return {
    background: `hsl(${hue} ${sat}% ${lightBg}%)`,
    color: `hsl(${hue} ${Math.min(95, sat + 15)}% ${lightFg}%)`,
  }
}

function energyColor(energy: number): string {
  // 1 → cool blue, 5 → green, 10 → red. Smooth interpolation through hue.
  // Hue 220 (blue) → 130 (green) → 0 (red), through 9 steps.
  const e = Math.max(1, Math.min(10, energy))
  const t = (e - 1) / 9
  const hue = 220 - t * 220 // 220 → 0
  return `hsl(${hue} 70% 55%)`
}
