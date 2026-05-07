/// Single shared AudioContext for the whole app.
/// Browsers require a user gesture before audio can play, so call ensureAudio()
/// inside a click handler (or any user-initiated event) the first time.
let ctx: AudioContext | null = null

export async function ensureAudio(): Promise<AudioContext> {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  return ctx
}

export function getAudioContext(): AudioContext | null {
  return ctx
}
