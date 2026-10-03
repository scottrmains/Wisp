import { useQuery } from '@tanstack/react-query'
import { UserRound } from 'lucide-react'
import { accounts } from '../../api/accounts'
import { Button } from '../../components/ui/Button'
import { StatusMessage } from '../../components/ui/StatusMessage'

export function AccountSettings({ active }: { active: boolean }) {
  const status = useQuery({
    queryKey: ['account-status'],
    queryFn: ({ signal }) => accounts.status(signal),
    enabled: active,
    retry: false,
    staleTime: 60_000,
  })
  return (
    <section className="settings-section" aria-labelledby="account-settings-heading">
      <h3 id="account-settings-heading" className="settings-section-title">
        Your WISP account
      </h3>
      {status.isPending && active && <StatusMessage>Checking account status…</StatusMessage>}
      {status.isError && (
        <StatusMessage tone="error">
          Account status could not load. Your local library and music tools are still available.{' '}
          <Button small onClick={() => void status.refetch()}>
            Retry account status
          </Button>
        </StatusMessage>
      )}
      {status.data?.contractVersion === 1 && status.data.state === 'Guest' && (
        <div className="settings-account-status">
          <UserRound size={24} aria-hidden="true" />
          <div>
            <p className="font-semibold">Using WISP as Guest</p>
            <p className="text-[var(--color-muted)]">No WISP account is connected.</p>
          </div>
        </div>
      )}
      {status.data && (status.data.contractVersion !== 1 || status.data.state !== 'Guest') && (
        <StatusMessage>
          Account support needs a compatible WISP update. Local tools remain available.
        </StatusMessage>
      )}
      <p className="settings-intro mb-0">
        Your library, cue points, playlists and recordings stay on this computer. Cloud accounts and
        sharing are not available in this version. No sign-in or subscription is needed.
      </p>
    </section>
  )
}
