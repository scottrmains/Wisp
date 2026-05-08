import { useState } from 'react'
import type { CuePoint, CuePointType } from '../../api/types'
import { useCues } from './useCues'

interface Props {
  trackId: string
  hasBpm: boolean
  currentTime: number
  onSeek: (seconds: number) => void
}

const TYPE_OPTIONS: CuePointType[] = [
  'FirstBeat',
  'Intro',
  'MixIn',
  'Breakdown',
  'Drop',
  'VocalIn',
  'MixOut',
  'Outro',
  'Custom',
]

export function CuePointEditor({ trackId, hasBpm, currentTime, onSeek }: Props) {
  const { cues, loading, create, remove, generatePhraseMarkers } = useCues(trackId)
  const [pendingType, setPendingType] = useState<CuePointType>('Custom')

  const dropCue = () =>
    create.mutate({
      timeSeconds: currentTime,
      type: pendingType,
      label: pendingType,
    })

  const firstBeatCue = cues.find((c) => c.type === 'FirstBeat')

  const generate = () => {
    const firstBeat = firstBeatCue?.timeSeconds ?? currentTime
    generatePhraseMarkers.mutate({ firstBeatSeconds: firstBeat, stepBeats: 64, replaceExisting: true })
  }

  return (
    <div className="mt-2 rounded-md border border-[var(--color-border)]/60 bg-[var(--color-bg)] p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Cues</span>
        <select
          value={pendingType}
          onChange={(e) => setPendingType(e.target.value as CuePointType)}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[11px]"
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button
          onClick={dropCue}
          className="rounded bg-[var(--color-accent)] px-2 py-0.5 text-[11px] font-medium text-white"
          title={`Drop a ${pendingType} cue at ${currentTime.toFixed(1)}s`}
        >
          + at {currentTime.toFixed(1)}s
        </button>

        <button
          onClick={generate}
          disabled={!hasBpm || generatePhraseMarkers.isPending}
          className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-muted)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          title={
            !hasBpm
              ? 'Track has no BPM — phrase markers need it'
              : firstBeatCue
                ? `Generate phrase markers from FirstBeat (${firstBeatCue.timeSeconds.toFixed(2)}s)`
                : `Generate phrase markers using current time (${currentTime.toFixed(2)}s) as the first beat`
          }
        >
          {generatePhraseMarkers.isPending ? 'Generating…' : 'Phrase markers'}
        </button>

        <span className="ml-auto text-[10px] text-[var(--color-muted)]">{cues.length} cues</span>
      </div>

      {loading && <p className="mt-2 text-[11px] text-[var(--color-muted)]">Loading cues…</p>}

      {cues.length > 0 && (
        <ul className="mt-2 max-h-24 overflow-y-auto text-[11px]">
          {cues.map((c) => (
            <CueRow key={c.id} cue={c} onSeek={onSeek} onRemove={() => remove.mutate(c.id)} />
          ))}
        </ul>
      )}
    </div>
  )
}

function CueRow({ cue, onSeek, onRemove }: { cue: CuePoint; onSeek: (s: number) => void; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-2 py-0.5 hover:bg-white/5">
      <button onClick={() => onSeek(cue.timeSeconds)} className="font-mono tabular-nums text-[var(--color-accent)]">
        {cue.timeSeconds.toFixed(2)}s
      </button>
      <span className="text-[var(--color-muted)]">{cue.type}</span>
      <span className="truncate">{cue.label}</span>
      {cue.isAutoSuggested && <span className="rounded bg-amber-400/20 px-1 text-[9px] text-amber-300">auto</span>}
      <button
        onClick={onRemove}
        className="ml-auto text-[var(--color-muted)] hover:text-red-400"
        aria-label="Delete cue"
      >
        ×
      </button>
    </li>
  )
}
