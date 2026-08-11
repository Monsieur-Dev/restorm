import React, { useEffect, useRef } from 'react'
import Lottie, { type LottieRefCurrentProps } from 'lottie-react'
import { starLottieAnimationData } from 'electron-core-ui/renderer'

/**
 * `FavoritesIllustration` — animated illustration for the
 * `tips.favorites` text. Reuses the exact same Lottie animation
 * that drives the ECUI Toggle's `appearance="star"` (the empty →
 * filled-with-burst sequence), placed on top of the amber disc
 * background that visually matches the mcpControl / authRequests
 * / supplyChain tips.
 *
 * Plays once at mount, then waits `PAUSE_MS` before replaying —
 * a flat `loop: true` would restart the burst the instant the
 * star fills, which reads as a constant flicker. The pause gives
 * the reader a beat to see the result of the favourite action.
 */
const PAUSE_BETWEEN_LOOPS_MS = 8000

export const FavoritesIllustration: React.FC = () => {
  const lottieRef = useRef<LottieRefCurrentProps>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const handleComplete = (): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      lottieRef.current?.goToAndPlay(0, true)
    }, PAUSE_BETWEEN_LOOPS_MS)
  }

  return (
    <div className="fv-wrap">
      <svg
        viewBox="0 0 220 150"
        xmlns="http://www.w3.org/2000/svg"
        className="fv-disc-svg"
        aria-hidden="true"
      >
        <circle cx="180" cy="95" r="85" fill="#f59e0b" />
      </svg>
      <div className="fv-lottie-slot">
        <Lottie
          lottieRef={lottieRef}
          animationData={starLottieAnimationData}
          loop={false}
          autoplay
          onComplete={handleComplete}
          rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
        />
      </div>
    </div>
  )
}
