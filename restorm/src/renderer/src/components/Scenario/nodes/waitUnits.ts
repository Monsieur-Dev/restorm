/**
 * Time units shared by the `wait` node's inline duration editor + box.
 * Kept in a non-component module so React Fast Refresh stays happy
 * (a component file must export only components).
 *
 * The engine mirrors `WAIT_UNIT_MS` in `scenarioEngine/executors/
 * timeAndFlowExecutors.ts` — a `.ts` here can't be imported into the
 * main process, so the two copies are kept in sync by hand.
 */

/** Time units offered by the wait node's duration control. */
export const WAIT_UNITS = ['ms', 's', 'min', 'h'] as const
export type WaitUnit = (typeof WAIT_UNITS)[number]

/** Multiplier from each unit to milliseconds. */
export const WAIT_UNIT_MS: Record<WaitUnit, number> = { ms: 1, s: 1000, min: 60_000, h: 3_600_000 }

export const isWaitUnit = (v: unknown): v is WaitUnit =>
  typeof v === 'string' && (WAIT_UNITS as readonly string[]).includes(v)
