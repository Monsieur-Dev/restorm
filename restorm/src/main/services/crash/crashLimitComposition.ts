/**
 * The process-wide crash-report budget.
 *
 * A module-level limiter because the budget is per RUN of the app: it has to
 * outlive any one report and be shared by every path that produces one, which
 * is exactly what a session cap means.
 *
 * The limiter itself holds only timestamps and answers synchronously, so unlike
 * the review gate beside it there is no in-flight state here that a failure
 * could strand. That is deliberate: this sits in the same send path, and a
 * second gate that could wedge would be a second way to silence reporting for a
 * whole session.
 */

import { logger } from 'electron-core-ui/main'
import { CrashRateLimiter, type CrashLimitVerdict } from './crashRateLimiter'

let limiter: CrashRateLimiter | null = null

function get(): CrashRateLimiter {
  limiter ??= new CrashRateLimiter()
  return limiter
}

/**
 * Whether one report fits in the remaining budget, recording it if so.
 *
 * Runs BEFORE the per-report review, so a report that will be held back never
 * raises a dialog — asking someone to approve a send that is then discarded
 * wastes their attention and misdescribes what is happening.
 *
 * Never throws: a limiter that failed would otherwise be able to block
 * reporting entirely, and the safe direction for a BUDGET (unlike consent) is
 * to let the report through — the server-side quota is the real cap.
 */
export function allowCrashReport(fingerprint: string): boolean {
  let verdict: CrashLimitVerdict
  try {
    verdict = get().check(fingerprint)
  } catch (error) {
    logger.warn('Crash report budget check failed; allowing the report', {
      message: error instanceof Error ? error.message : String(error)
    })
    return true
  }
  if (verdict === 'send') return true
  logger.info('Crash report held back by the client-side budget', { verdict, fingerprint })
  return false
}

/** Reset between tests. */
export function resetCrashLimiter(): void {
  limiter = null
}
