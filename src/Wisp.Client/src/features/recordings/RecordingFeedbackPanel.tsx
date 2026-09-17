import { useState } from 'react'
import { Plus, Save, Star } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { confirmDialog } from '../../components/dialog'
import { formatTrackStart, parseTrackStart, useRecordingTracklist } from './useRecordingTracklist'
import {
  emptyFeedback,
  feedbackKey,
  saveFeedback,
  useFeedbackDrafts,
  useRecordingFeedback,
  type Annotation,
  type CommentDraft,
  type Feedback,
} from './useRecordingFeedback'

const button = 'wm-button wm-quiet'
const field = 'wm-field'
const categories = ['Transition', 'Phrasing', 'Levels', 'Track choice', 'Keep this']

export function RecordingFeedbackPanel({
  id,
  position,
  duration,
  live,
  canPlay,
  seek,
  loop,
}: {
  id: string
  title: string
  position: number
  duration: number
  live: boolean
  canPlay: boolean
  seek: (seconds: number) => void
  loop: (start: number, end: number) => void
}) {
  const query = useRecordingFeedback(id)
  const tracklist = useRecordingTracklist(id)
  const qc = useQueryClient()
  const draft = useFeedbackDrafts((s) => s.drafts[id])
  const put = useFeedbackDrafts((s) => s.put)
  const feedback = draft?.feedback ?? (query.data?.annotations ? query.data : emptyFeedback)
  const composer = draft?.composer
  const entries = tracklist.data?.entries ?? []
  const [saved, setSaved] = useState(false)
  const [filter, setFilter] = useState('all')
  const [preRoll, setPreRoll] = useState(3)
  const busy = !!draft?.saving
  const disabled = busy || query.isPending || !!query.error
  const change = (next: Feedback, nextComposer = composer ?? null) => {
    setSaved(false)
    put(id, { feedback: next, composer: nextComposer, error: null, saving: false })
  }
  const editComposer = (patch: Partial<CommentDraft>) => {
    if (composer) change(feedback, { ...composer, ...patch })
  }
  const openComment = (a?: Annotation) =>
    change(feedback, {
      id: a?.id ?? crypto.randomUUID(),
      start: formatTrackStart(a?.seconds ?? position),
      end: a?.endSeconds == null ? '' : formatTrackStart(a.endSeconds),
      text: a?.text ?? '',
      category: a?.category ?? '',
      resolved: a?.resolved ?? false,
      occurrenceId: a?.occurrenceId ?? '',
      toOccurrenceId: a?.toOccurrenceId ?? '',
      live: !a && live,
    })
  const save = async () => {
    let next = feedback
    if (composer) {
      const start = parseTrackStart(composer.start)
      const end = composer.end ? parseTrackStart(composer.end) : null
      if (
        !composer.text.trim() ||
        (!composer.live &&
          (start == null ||
            start > duration ||
            (composer.end && (end == null || end <= start || end > duration))))
      ) {
        put(id, {
          ...draft!,
          error: 'Add comment text and a valid point or range within this recording.',
          saving: false,
        })
        return
      }
      const annotation: Annotation = {
        id: composer.id,
        seconds: start ?? 0,
        endSeconds: composer.live ? null : end,
        text: composer.text.trim(),
        category: composer.category || null,
        resolved: composer.resolved,
        occurrenceId: composer.occurrenceId || null,
        toOccurrenceId: composer.toOccurrenceId || null,
        associationLabel:
          feedback.annotations.find((a) => a.id === composer.id)?.associationLabel ?? null,
      }
      next = {
        ...feedback,
        annotations: [...feedback.annotations.filter((a) => a.id !== annotation.id), annotation],
      }
    }
    const ok = await saveFeedback(id, next, composer?.live ? composer.id : undefined)
    // Always invalidate even if the page was left while saving. Draft errors live in the store.
    await qc.invalidateQueries({ queryKey: feedbackKey(id) })
    await qc.invalidateQueries({ queryKey: ['recording-workspace-mixes'] })
    await qc.invalidateQueries({ queryKey: ['recording-review', id] })
    if (ok) setSaved(true)
  }
  const discard = async () => {
    if (
      await confirmDialog({
        title: 'Discard this local review draft?',
        message:
          'Unsaved notes, comment edits and status changes for this mix will be discarded. Saved feedback remains unchanged.',
        confirmLabel: 'Discard draft',
        danger: true,
      })
    ) {
      useFeedbackDrafts.getState().discard(id)
      setSaved(false)
      await query.refetch()
    }
  }
  const comments = feedback.annotations
    .filter((a) => filter === 'all' || (filter === 'resolved' ? a.resolved : !a.resolved))
    .sort((a, b) => a.seconds - b.seconds)
  return (
    <section aria-label="Detailed mix review" className="wm-feedback">
      <div className="wm-review-toolbar">
        <div className="wm-rating" role="group" aria-label="Satisfaction">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              className={`wm-star ${(feedback.rating ?? 0) >= n ? 'is-filled' : ''}`}
              disabled={disabled}
              aria-label={`Rate ${n} out of 5`}
              aria-pressed={feedback.rating === n}
              onClick={() => change({ ...feedback, rating: n })}
            >
              <Star />
            </button>
          ))}
          <button
            className="wm-button wm-quiet"
            disabled={disabled || feedback.rating == null}
            onClick={() => change({ ...feedback, rating: null })}
          >
            {feedback.rating == null ? 'Unrated' : 'Clear rating'}
          </button>
        </div>
        <label className="wm-status-field">
          Review status
          <select
            className="wm-field"
            disabled={disabled}
            value={feedback.status}
            onChange={(e) => change({ ...feedback, status: e.target.value })}
          >
            {['Practice', 'Needs review', 'Ready to share'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <button
          className="wm-button wm-primary"
          disabled={disabled || !draft}
          onClick={() => void save()}
        >
          <Save /> {busy ? 'Saving feedback…' : 'Save feedback'}
        </button>
        {draft && (
          <button className="wm-button wm-quiet" disabled={busy} onClick={() => void discard()}>
            Discard draft / reload saved
          </button>
        )}
      </div>
      {draft && (
        <p role="status" className="wm-draft-status">
          {busy
            ? 'Saving to WISP… You can navigate away.'
            : 'Unsaved changes kept on this device. Save feedback to commit your rating, notes and comments.'}
        </p>
      )}
      {saved && !draft && (
        <p role="status" className="wm-saved">
          Feedback saved
        </p>
      )}
      {(draft?.error || query.error) && (
        <p role="alert">
          {draft?.error ?? query.error?.message}{' '}
          {query.error && (
            <button className="underline" onClick={() => void query.refetch()}>
              Retry loading
            </button>
          )}
        </p>
      )}
      <div className="wm-review-columns">
        <div className="wm-listening-notes">
          <div className="wm-heading">
            <h3>Listening notes · {feedback.annotations.length}</h3>
            <select
              aria-label="Show comments"
              className="wm-field"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All comments</option>
              <option value="revisit">To revisit</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
          {comments.length === 0 && (
            <p className="text-sm text-[var(--color-muted)]">
              {filter === 'all'
                ? 'Add a note at the playhead to capture what worked or what to practise next.'
                : 'No comments in this view.'}
            </p>
          )}
          {comments.map((a) => (
            <article
              key={a.id}
              aria-label={`Comment: ${a.text}`}
              className="space-y-2 border-t border-[var(--color-border)] py-3"
            >
              <button
                className="min-h-11 text-left text-sm underline disabled:opacity-40"
                disabled={!canPlay}
                onClick={() => seek(Math.max(0, Math.min(duration, a.seconds - preRoll)))}
              >
                {formatTrackStart(a.seconds)}
                {a.endSeconds != null && ` – ${formatTrackStart(a.endSeconds)}`}
              </button>
              <p className="whitespace-pre-wrap break-words text-sm">{a.text}</p>
              <p className="break-words text-xs text-[var(--color-muted)]">
                {a.category ?? 'Comment'} · {a.resolved ? 'Resolved' : 'To revisit'}
                {a.associationLabel && ` · ${a.associationLabel}`}
                {feedback.detachedAnnotationIds?.includes(a.id) &&
                  ' · Tracklist association removed; note and timing preserved'}
              </p>
              <div className="flex flex-wrap gap-2">
                {a.endSeconds != null && (
                  <button
                    className={button}
                    disabled={!canPlay}
                    onClick={() => loop(a.seconds, a.endSeconds!)}
                  >
                    Loop comment range
                  </button>
                )}
                <button
                  className={button}
                  disabled={disabled || !!composer}
                  onClick={() => openComment(a)}
                >
                  Edit comment
                </button>
                <button
                  className={button}
                  disabled={disabled || !!composer}
                  onClick={() =>
                    change({
                      ...feedback,
                      annotations: feedback.annotations.map((note) =>
                        note.id === a.id ? { ...note, resolved: !note.resolved } : note,
                      ),
                    })
                  }
                >
                  {a.resolved ? 'Revisit again' : 'Mark resolved'}
                </button>
                <button
                  className={button}
                  disabled={disabled || !!composer}
                  onClick={() =>
                    change({
                      ...feedback,
                      annotations: feedback.annotations.filter((note) => note.id !== a.id),
                    })
                  }
                >
                  Remove comment (draft)
                </button>
              </div>
            </article>
          ))}

          <label className="wm-subtitle">
            Comment pre-roll{' '}
            <select
              className="wm-field"
              value={preRoll}
              onChange={(e) => setPreRoll(+e.target.value)}
            >
              {[0, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n}s
                </option>
              ))}
            </select>
          </label>
        </div>
        <aside className="wm-note-composer">
          <h3>Add a listening note</h3>
          <p className="wm-subtitle">
            {live ? 'Using the recorder clock' : `Playhead · ${formatTrackStart(position)}`}
          </p>
          <button
            className="wm-button"
            disabled={disabled || !!composer || feedback.annotations.length >= 500}
            onClick={() => openComment()}
          >
            <Plus /> Add comment{live ? ' (live)' : ' here'}
          </button>
          {composer && (
            <fieldset
              disabled={disabled}
              className="space-y-3 border-y border-[var(--color-border)] py-4"
            >
              <legend className="text-sm font-medium">
                {feedback.annotations.some((a) => a.id === composer.id)
                  ? 'Edit comment'
                  : 'New comment'}
              </legend>
              <label className="flex flex-col gap-1 text-sm">
                Comment
                <textarea
                  className={field}
                  rows={3}
                  maxLength={4000}
                  value={composer.text}
                  onChange={(e) => editComposer({ text: e.target.value })}
                />
              </label>
              {composer.live ? (
                <div className="space-y-2 text-xs text-[var(--color-muted)]">
                  <p>
                    {live
                      ? 'The point is marked using the recorder clock when you save feedback. No browser timer or track recognition.'
                      : 'This recording stopped before the live comment was saved. Choose its time explicitly; your text is preserved.'}
                  </p>
                  {!live && (
                    <button
                      type="button"
                      className={button}
                      onClick={() =>
                        editComposer({ live: false, start: formatTrackStart(position), end: '' })
                      }
                    >
                      Set comment time from playhead
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                    Comment start
                    <input
                      className={field}
                      value={composer.start}
                      onChange={(e) => editComposer({ start: e.target.value })}
                    />
                  </label>
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                    Comment end (optional)
                    <input
                      className={field}
                      value={composer.end}
                      onChange={(e) => editComposer({ end: e.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className={button}
                    onClick={() => editComposer({ end: formatTrackStart(position) })}
                  >
                    Use playhead as end
                  </button>
                </div>
              )}
              <details>
                <summary>Category & track association</summary>
                <div className="flex flex-wrap gap-3">
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                    Category
                    <select
                      className={field}
                      value={composer.category}
                      onChange={(e) => editComposer({ category: e.target.value })}
                    >
                      <option value="">No category</option>
                      {categories.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                    Track occurrence (optional)
                    <select
                      className={field}
                      value={composer.occurrenceId}
                      onChange={(e) =>
                        editComposer({ occurrenceId: e.target.value, toOccurrenceId: '' })
                      }
                    >
                      <option value="">Unassigned</option>
                      {composer.occurrenceId &&
                        !entries.some((e) => e.id === composer.occurrenceId) && (
                          <option value={composer.occurrenceId}>
                            Removed occurrence (association preserved)
                          </option>
                        )}
                      {entries.map((e, i) => (
                        <option key={e.id} value={e.id}>
                          {i + 1}. {e.artist} — {e.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                    Transition into (optional)
                    <select
                      className={field}
                      disabled={!composer.occurrenceId}
                      value={composer.toOccurrenceId}
                      onChange={(e) => editComposer({ toOccurrenceId: e.target.value })}
                    >
                      <option value="">Track only</option>
                      {composer.toOccurrenceId &&
                        !entries.some((e) => e.id === composer.toOccurrenceId) && (
                          <option value={composer.toOccurrenceId}>
                            Removed occurrence (association preserved)
                          </option>
                        )}
                      {entries
                        .filter((e) => e.id !== composer.occurrenceId)
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.artist} — {e.title}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              </details>
              <div className="wm-actions">
                <button type="button" className="wm-button wm-primary" onClick={() => void save()}>
                  Save comment & feedback
                </button>
                <button type="button" className={button} onClick={() => change(feedback, null)}>
                  Cancel comment edit
                </button>
              </div>
              <p className="text-xs text-[var(--color-muted)]">
                Saves this comment and all review edits. Times refer to this recording, not song
                cues.
              </p>
            </fieldset>
          )}

          <details open={feedback.notes ? true : undefined}>
            <summary>Personal reflection</summary>
            <label className="flex flex-col gap-1 text-sm">
              Overall notes
              <textarea
                className={field}
                rows={3}
                maxLength={10000}
                value={feedback.notes}
                disabled={disabled}
                onChange={(e) => change({ ...feedback, notes: e.target.value })}
              />
            </label>
          </details>
        </aside>
      </div>
    </section>
  )
}
