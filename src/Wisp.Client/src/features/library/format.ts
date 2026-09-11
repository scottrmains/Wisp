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

const trackDateFormat = new Intl.DateTimeFormat(undefined, {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

export function formatTrackDate(value: string | null): string {
  if (!value) return '—'
  // Older SQLite timestamps lacked the UTC suffix; they were still written in UTC.
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`)
  return Number.isNaN(date.getTime()) ? '—' : trackDateFormat.format(date)
}
