import { getAudioContext } from './context'

/// WebView2 has a long history of CHECK()-firing crashes when the host yanks the
/// page out from under active media (audio elements still playing, iframes still
/// loading subresources, AudioContext still open). When Photino tells WebView2 to
/// close the window, the cleanest thing is to release media handles ourselves before
/// the browser tries to.
///
/// Listen for both `pagehide` (fires on every nav-away in WebView2) and
/// `beforeunload` (fires on actual close). Idempotent — safe to fire twice.
let installed = false
let alreadyTornDown = false

export function installGracefulShutdown() {
  if (installed) return
  installed = true

  const teardown = () => {
    if (alreadyTornDown) return
    alreadyTornDown = true

    // Pause + detach every <audio>. removeAttribute('src') + load() releases the
    // underlying media stream cleanly; Web Audio's MediaElementSource won't crash
    // when the element disconnects after this.
    document.querySelectorAll('audio').forEach((el) => {
      try {
        el.pause()
        el.removeAttribute('src')
        el.load()
      } catch {
        /* best effort */
      }
    })

    // Clear iframe srcs — YouTube embeds in particular keep network connections
    // and renderer state alive in ways WebView2 dislikes during shutdown.
    document.querySelectorAll('iframe').forEach((el) => {
      try {
        el.src = 'about:blank'
      } catch {
        /* best effort */
      }
    })

    // Close the shared AudioContext if we have one. SoundTouchJS AudioWorklet keeps
    // an active processing graph; close() tears it down cleanly.
    try {
      const ctx = getAudioContext()
      if (ctx && ctx.state !== 'closed') void ctx.close()
    } catch {
      /* best effort */
    }
  }

  window.addEventListener('pagehide', teardown)
  window.addEventListener('beforeunload', teardown)
  // Photino's own close path doesn't always fire beforeunload — listen for visibility
  // change to "hidden" as a backup signal.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') teardown()
  })
}
