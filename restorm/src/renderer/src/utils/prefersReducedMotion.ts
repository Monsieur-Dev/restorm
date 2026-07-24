/**
 * Whether the user asked the OS for reduced motion.
 *
 * Border-beam trails carry `animation: none` under that setting (see
 * `electron-core-ui/src/renderer/effects/border/borderBeam/borderBeam.css`),
 * so no `animationiteration` is ever emitted for them. Every beam that stops
 * "on the next lap boundary" has to consult this and stop immediately
 * instead, or its overlay stays mounted for good.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
