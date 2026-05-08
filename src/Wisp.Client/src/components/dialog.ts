/// App-wide replacement for window.confirm / window.prompt / window.alert.
///
/// The native dialogs aren't styled to match the dark UI, can't render rich
/// content (warnings, validation), and on Windows in WebView2 they pop a
/// jarring system chrome window. This module exposes the same imperative
/// usage pattern (`const ok = await confirmDialog(...)`) but renders through
/// a styled in-app modal hosted at the App root.
///
/// Usage:
///   if (!(await confirmDialog({ title: 'Delete?', message: '...' }))) return
///   const name = await promptDialog({ title: 'New name', defaultValue: '' })
///   await alertDialog({ title: 'Error', message: e.message, tone: 'error' })
///
/// The promise resolves to:
///   confirmDialog → boolean
///   promptDialog  → string when confirmed, null when cancelled
///   alertDialog   → void on dismiss

import { create } from 'zustand'

export interface ConfirmOptions {
  title: string
  /// Plain message body. For richer content use `body` (a JSX node) instead.
  message?: string
  body?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /// `danger` paints the confirm button red (use for destructive actions).
  danger?: boolean
}

export interface PromptOptions {
  title: string
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  maxLength?: number
  /// Extra synchronous validator. Returning a string keeps the dialog open
  /// and shows the message inline. Returning null/undefined means valid.
  validate?: (value: string) => string | null | undefined
}

export interface AlertOptions {
  title: string
  message: string
  tone?: 'info' | 'error'
  confirmLabel?: string
}

export type Pending =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }
  | { kind: 'alert'; opts: AlertOptions; resolve: () => void }

interface DialogStore {
  current: Pending | null
  open: (p: Pending) => void
  close: () => void
}

export const useDialogStore = create<DialogStore>((set) => ({
  current: null,
  open: (p) => set({ current: p }),
  close: () => set({ current: null }),
}))

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useDialogStore.getState().open({
      kind: 'confirm',
      opts,
      resolve: (v) => {
        useDialogStore.getState().close()
        resolve(v)
      },
    })
  })
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    useDialogStore.getState().open({
      kind: 'prompt',
      opts,
      resolve: (v) => {
        useDialogStore.getState().close()
        resolve(v)
      },
    })
  })
}

export function alertDialog(opts: AlertOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    useDialogStore.getState().open({
      kind: 'alert',
      opts,
      resolve: () => {
        useDialogStore.getState().close()
        resolve()
      },
    })
  })
}
