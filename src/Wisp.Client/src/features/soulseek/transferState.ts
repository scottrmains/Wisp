export function transferState(state: string) {
  const flags = new Set(state.split(',').map(s => s.trim().toLowerCase()))
  const cancelled = flags.has('cancelled')
  const failed = ['errored', 'timedout', 'rejected', 'aborted', 'failed'].some(s => flags.has(s))
  const succeeded = flags.has('succeeded') && !cancelled && !failed
  const finished = flags.has('completed') || cancelled || failed || succeeded
  const label = cancelled ? 'Cancelled' : failed ? 'Failed' : succeeded ? 'Done'
    : finished ? 'Finished' : flags.has('queued') ? 'Queued'
    : flags.has('inprogress') ? 'Downloading' : state || 'Waiting'
  return { finished, cancelled, failed, succeeded, label }
}

export function transferPercent(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
}
