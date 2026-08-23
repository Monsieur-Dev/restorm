import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MosaicCard } from 'electron-core-ui/renderer'
import { TIP_ILLUSTRATIONS } from './tip-illustrations'

/**
 * `TipsCard` — rotating cheat-sheet of restorm UX tricks. Picks a
 * random tip on mount, then runs a three-phase rotation every
 * 10 seconds:
 *
 *   1. **Fade out** — opacity 1 → 0 over `FADE_MS` ms while the
 *      card keeps its current height. The reader's eye knows
 *      something is leaving.
 *   2. **Resize**   — the new tip is mounted while still
 *      invisible; the rotator's height transitions from the old
 *      tip's measured pixel height to the new one over `RESIZE_MS`
 *      ms. We pin pixel values explicitly (rather than relying on
 *      `height: auto` + `interpolate-size`) because the latter is
 *      unreliable in flex contexts.
 *   3. **Fade in**  — opacity 0 → 1 over `FADE_MS` ms. The new
 *      content lands on a card that has already settled, so the
 *      reveal feels clean rather than jumpy.
 *
 * Adding a tip is two locale entries (`tips.<key>.title` +
 * `tips.<key>.body`) plus a push to `TIP_KEYS`; i18next falls back
 * to en for locales that haven't translated a key yet.
 */

/** Stable list of tip keys. Extend by appending — order doesn't
 *  matter (rotation is random). */
const TIP_KEYS: string[] = [
  'maximizeTab',
  'mcpControl',
  'envSwitch',
  'authRequests',
  'supplyChain',
  'codeSnippets',
  'workbenchLayout',
  'persistState',
  'favorites',
  'console',
  'miniBrowser',
  'apiDocs',
  'secrets',
  'themes',
  'search',
  'multiEnv',
  'protocols',
  'responseTree',
  'responseHistory',
  'multiLanguage',
  'chainRequests',
  'fromPostman',
  'codeLanguages',
  'stepByStep',
  'interactiveScenarios',
  'cicd',
  'scenarioAi',
  'nestedScenarios',
  'scenarioHistory',
  'codeSandbox',
  'customValueLists'
]

/** Number of available tips — lets callers (e.g. the empty-board fallback)
 *  seed several cards with distinct starting tips. */
export const TIP_COUNT = TIP_KEYS.length

/** TEMP — when this getter returns a non-null key, the card pins
 *  to that tip and the rotation timer is disabled. Used while
 *  iterating on a specific tip's content / illustration. Return
 *  `null` to re-enable the random rotation. Function-shaped on
 *  purpose so the flow-analyser can't fold the comparison away
 *  while the dev value is `null`. */
function getPinnedTipKey(): string | null {
  return null
}

type RotatorPhase = 'visible' | 'fade-out' | 'resize' | 'fade-in'

const ROTATION_INTERVAL_MS = 30_000
const FADE_MS = 1000
const RESIZE_MS = 1400

function pickInitialIndex(preferred?: number): number {
  if (TIP_KEYS.length === 0) return 0
  const pinned = getPinnedTipKey()
  if (pinned !== null) {
    const pinnedIdx = TIP_KEYS.indexOf(pinned)
    if (pinnedIdx !== -1) return pinnedIdx
  }
  // When several cards share the board (the empty-board fallback) the caller
  // seeds each with a distinct starting tip so they don't open on the same one.
  if (preferred !== undefined && preferred >= 0 && preferred < TIP_KEYS.length) {
    return preferred
  }
  return Math.floor(Math.random() * TIP_KEYS.length)
}

function pickNextIndex(current: number): number {
  if (TIP_KEYS.length <= 1) return current
  let next = Math.floor(Math.random() * (TIP_KEYS.length - 1))
  if (next >= current) next += 1
  return next
}

/**
 * The tip's illustration, isolated behind `React.memo` and keyed only on the
 * tip key. This is critical: the card re-renders when async deps settle on a
 * cold load (i18n resources, etc.), and without memoization that re-render
 * rebuilt the inlined SVG DOM — restarting its CSS animation mid-flight (a
 * visible reset on sequential animations). Memoized, the SVG is (re)built ONLY
 * when the tip actually changes, never on an incidental parent re-render.
 */
const TipIllustration: React.FC<{ tipKey: string }> = React.memo(({ tipKey }) => {
  const illustration = TIP_ILLUSTRATIONS[tipKey]
  if (!illustration) return null
  if (illustration.kind === 'svg') {
    // The SVG markup is a build-time `?raw` import from a trusted file in this
    // repo; inlining is required so the embedded `<style>` block can resolve
    // theme CSS variables and currentColor from the parent context.
    return <div className="empty-bench-tip-illustration-wrap" dangerouslySetInnerHTML={{ __html: illustration.markup }} />
  }
  const Component = illustration.Component
  return (
    <div className="empty-bench-tip-illustration-wrap">
      <Component />
    </div>
  )
})
TipIllustration.displayName = 'TipIllustration'

interface TipsCardProps {
  /** Optional starting tip index. Used by the empty-board fallback to seed
   *  several cards with distinct tips; omitted, the card picks at random. */
  readonly initialIndex?: number
}

export const TipsCard: React.FC<TipsCardProps> = ({ initialIndex }) => {
  const { t } = useTranslation()
  const [currentIndex, setCurrentIndex] = useState<number>(() => pickInitialIndex(initialIndex))
  const [phase, setPhase] = useState<RotatorPhase>('visible')
  const rotatorRef = useRef<HTMLDivElement | null>(null)
  const pinnedStartHeightRef = useRef<number | null>(null)
  const timersRef = useRef<number[]>([])

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id)
    timersRef.current = []
  }, [])

  // After the content swap (phase becomes 'resize'), measure the
  // new natural height and animate from the pinned start height to
  // it. After the resize phase ends we release the inline height
  // so the card can flow naturally for the next cycle.
  useLayoutEffect(() => {
    const el = rotatorRef.current
    if (!el) return
    if (phase === 'resize' && pinnedStartHeightRef.current !== null) {
      const start = pinnedStartHeightRef.current
      // Temporarily clear the inline height to measure the new
      // natural height, then restore it before the browser paints
      // so the transition starts from `start`.
      el.style.height = 'auto'
      const target = el.offsetHeight
      el.style.height = `${start}px`
      // Force layout so the browser commits `start` before we
      // change to `target` — without this, both styles collapse
      // into a single paint and the transition is skipped.
      void el.offsetHeight
      el.style.height = `${target}px`
    } else if (phase === 'fade-in' || phase === 'visible') {
      // Release the pin so flexbox can resume natural sizing.
      el.style.height = ''
      pinnedStartHeightRef.current = null
    }
  }, [phase, currentIndex])

  const scheduleRotation = useCallback(function rotate(): void {
    // Phase 1 — fade out the current tip while the card keeps
    // its current natural height.
    setPhase('fade-out')
    const swapAt = window.setTimeout(() => {
      // About to swap content + enter the resize phase. Pin the
      // current pixel height so the useLayoutEffect that runs
      // after the state update can transition from this exact
      // value to the new natural height.
      const el = rotatorRef.current
      if (el) {
        pinnedStartHeightRef.current = el.offsetHeight
        el.style.height = `${el.offsetHeight}px`
      }
      setCurrentIndex((prev) => pickNextIndex(prev))
      setPhase('resize')
      const fadeInAt = window.setTimeout(() => {
        // Phase 3 — fade the new tip in once the card has finished
        // resizing.
        setPhase('fade-in')
        const restAt = window.setTimeout(() => {
          setPhase('visible')
          // Loop: schedule the next rotation after we're back to a
          // fully-visible steady state. The named function
          // expression `rotate` self-references without depending
          // on the surrounding `const` (sidesteps the lint's
          // "self-reference before declaration" warning).
          const nextAt = window.setTimeout(rotate, ROTATION_INTERVAL_MS)
          timersRef.current.push(nextAt)
        }, FADE_MS)
        timersRef.current.push(restAt)
      }, RESIZE_MS)
      timersRef.current.push(fadeInAt)
    }, FADE_MS)
    timersRef.current.push(swapAt)
  }, [])

  useEffect(() => {
    if (TIP_KEYS.length <= 1) return undefined
    if (getPinnedTipKey() !== null) return undefined
    const kickoff = window.setTimeout(scheduleRotation, ROTATION_INTERVAL_MS)
    timersRef.current.push(kickoff)
    return clearTimers
  }, [scheduleRotation, clearTimers])

  const currentKey = TIP_KEYS[currentIndex] ?? TIP_KEYS[0]
  if (currentKey === undefined) {
    return null
  }

  return (
    <MosaicCard
      // The header carries the CURRENT tip's own title so several tip cards
      // on the board read as distinct entries instead of a wall of identical
      // "Tips & tricks" headers.
      title={t(`tips.${currentKey}.title`)}
      titleBackgroundColor="#eab308"
      data-testid="empty-bench-card-tips"
    >
      <div
        ref={rotatorRef}
        className="empty-bench-tip-rotator"
        data-tip-key={currentKey}
        data-phase={phase}
      >
        <span className="empty-bench-tip__body">
          {t(`tips.${currentKey}.body`)}
        </span>
        <TipIllustration tipKey={currentKey} />
      </div>
    </MosaicCard>
  )
}
