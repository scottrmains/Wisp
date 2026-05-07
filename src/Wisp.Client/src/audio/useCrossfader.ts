import { useEffect, useState } from 'react'

/// Equal-power crossfader. fade=0 → full A, fade=1 → full B, fade=0.5 → both at -3dB.
/// Drives `leftGain` and `rightGain` in tandem.
export function useCrossfader(leftGain: GainNode | null, rightGain: GainNode | null) {
  const [fade, setFade] = useState(0.5)

  useEffect(() => {
    if (leftGain) leftGain.gain.value = Math.cos((fade * Math.PI) / 2)
    if (rightGain) rightGain.gain.value = Math.sin((fade * Math.PI) / 2)
  }, [fade, leftGain, rightGain])

  return [fade, setFade] as const
}
