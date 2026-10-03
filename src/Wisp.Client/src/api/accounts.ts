import { apiGet } from './client'

export interface AccountStatus {
  contractVersion: 1
  state: 'Guest' | 'Connecting' | 'SignedIn' | 'Offline' | 'SignInRequired'
  displayName: string
  canSignIn: boolean
  cloudAvailable: boolean
  cloudState:
    | 'Disabled'
    | 'MissingConfiguration'
    | 'InvalidConfiguration'
    | 'NotImplemented'
    | 'Available'
  localCapabilities: string[]
  user: { userId: string; displayName: string; publicHandle: string | null } | null
}

export const accounts = {
  status: (signal?: AbortSignal) => apiGet<AccountStatus>('/api/account/status', undefined, signal),
}
