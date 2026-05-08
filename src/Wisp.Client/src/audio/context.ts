import { SoundTouchNode } from '@soundtouchjs/audio-worklet'
// The processor file is the worklet body — load via Vite's `?url` so we get a
// stable URL we can hand to AudioWorklet.addModule(). Use the package's public
// `./processor` export rather than reaching into `dist/`.
import processorUrl from '@soundtouchjs/audio-worklet/processor?url'

/// Single shared AudioContext for the whole app.
/// Browsers require a user gesture before audio can play, so call ensureAudio()
/// inside a click handler the first time.
///
/// We register the SoundTouchJS processor here — the module must be loaded
/// before any deck constructs its SoundTouchNode, so we await it as part of init.
let ctx: AudioContext | null = null
let workletReady: Promise<void> | null = null

export async function ensureAudio(): Promise<AudioContext> {
  if (!ctx) {
    ctx = new AudioContext()
    workletReady = SoundTouchNode.register(ctx, processorUrl).catch((err) => {
      console.error('SoundTouch worklet failed to register', err)
      // Don't throw — decks should still work without time-stretch.
      workletReady = Promise.resolve()
    })
  }
  if (ctx.state === 'suspended') await ctx.resume()
  if (workletReady) await workletReady
  return ctx
}

export function getAudioContext(): AudioContext | null {
  return ctx
}
