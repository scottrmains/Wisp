export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatBpm(bpm: number | null): string {
  if (bpm === null) return '—'
  return bpm.toFixed(bpm % 1 === 0 ? 0 : 1)
}
