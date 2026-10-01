import type { ReactNode } from 'react'

export function StatusMessage({
  children,
  tone = 'info',
}: {
  children: ReactNode
  tone?: 'info' | 'error' | 'success'
}) {
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`ui-status ui-status--${tone}`}>
      {children}
    </p>
  )
}
