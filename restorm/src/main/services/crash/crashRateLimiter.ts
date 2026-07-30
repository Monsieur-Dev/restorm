/**
 * How much crash reporting one client may send.
 *
 * The quota this protects is small (a few thousand events a month for the whole
 * user base), so a single machine stuck in a crash loop could consume a visible
 * fraction of it alone. The limiter bounds what ONE client sends; the fleet-wide
 * bound is a server-side quota cap, which is the only thing that can see a
 * thousand clients at once.
 *
 * DELIBERATELY STATELESS-ISH AND SYNCHRONOUS. It holds a list of timestamps and
 * nothing else: no promises, no pending flags, no teardown, no listeners. That
 * is a direct response to how the neighbouring review gate failed — a pending
 * flag that could be left `true` forever silently disabled reporting for a whole
 * session. A gate in this path must have no state that can wedge, so this one
 * computes a verdict from a clock and a list and returns immediately. There is
 * no state here that a later bug could strand.
 *
 * Pure over injected `now`/`random`, so every window and boundary is testable
 * without waiting for real time to pass.
 */

/** Why a report was allowed or held back. */
export type CrashLimitVerdict =
  /** Within every limit — may proceed. */
  | 'send'
  /** The same failure was already reported recently. */
  | 'duplicate'
  /** Too many distinct reports in a short window. */
  | 'rate-limited'
  /** The session has sent all it may. */
  | 'session-cap'
  /** Discarded by sampling. Inactive by default — see the config. */
  | 'sampled-out'

export interface CrashRateLimitConfig {
  /** Most reports one run of the app may send, however long it runs. */
  maxPerSession: number
  /** Most reports in any `windowMs`, to flatten a burst. */
  maxPerWindow: number
  windowMs: number
  /** How long a fingerprint stays "already reported". */
  dedupeWindowMs: number
  /**
   * Fraction of otherwise-sendable reports to keep, 0..1.
   *
   * DEFAULT 1 — sampling is off. It is implemented so the rate can be dialled
   * down in a future release without a code change, but it stays inactive
   * because its failure mode is the wrong one here: sampling discards DISTINCT
   * crashes, and a rare bug seen once is both the most valuable report and the
   * likeliest to be thrown away. Repeats, which are the actual flood, are
   * already handled by dedup — so sampling would cost signal without buying
   * much the caps and the server-side quota do not already provide.
   */
  sampleRate: number
}

/**
 * Chosen against a free-tier quota of a few thousand events a month. Ten per
 * session is generous for a real fault and still bounded; three a minute keeps
 * a fast loop from spending the session budget in seconds; five minutes of
 * dedup covers a repeating fault without hiding a genuine recurrence an hour
 * later.
 */
export const DEFAULT_CRASH_RATE_LIMITS: CrashRateLimitConfig = {
  maxPerSession: 10,
  maxPerWindow: 3,
  windowMs: 60_000,
  dedupeWindowMs: 5 * 60_000,
  sampleRate: 1
}

export interface CrashRateLimiterOptions {
  config?: Partial<CrashRateLimitConfig> | undefined
  now?: (() => number) | undefined
  random?: (() => number) | undefined
}

export class CrashRateLimiter {
  private readonly config: CrashRateLimitConfig
  private readonly now: () => number
  private readonly random: () => number
  /** When each fingerprint was last SENT. */
  private readonly lastSent = new Map<string, number>()
  /** Timestamps of reports sent this session, oldest first. */
  private sentAt: number[] = []

  constructor(options: CrashRateLimiterOptions = {}) {
    this.config = { ...DEFAULT_CRASH_RATE_LIMITS, ...options.config }
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
  }

  /** Reports sent this session. */
  sentCount(): number {
    return this.sentAt.length
  }

  /**
   * Decide whether one report may proceed, and record it if so.
   *
   * Only a report that is actually going to be sent counts against the budgets.
   * A duplicate must not consume the session's allowance — otherwise a single
   * looping fault would exhaust it and silence every OTHER fault that followed,
   * which is precisely backwards: dedup exists so that a loop costs one report,
   * not so that it costs all of them.
   */
  check(fingerprint: string): CrashLimitVerdict {
    const now = this.now()

    const previous = this.lastSent.get(fingerprint)
    if (previous !== undefined && now - previous < this.config.dedupeWindowMs) {
      return 'duplicate'
    }
    if (this.sentAt.length >= this.config.maxPerSession) {
      return 'session-cap'
    }
    // Counted, never pruned: `sentAt` is the session's whole history, which is
    // what `maxPerSession` is measured against. The window is a view over it, so
    // it rolls forward on its own as timestamps age out of the comparison.
    // Bounded by `maxPerSession`, so the list stays tiny.
    const inWindow = this.sentAt.filter((at) => now - at < this.config.windowMs).length
    if (inWindow >= this.config.maxPerWindow) {
      return 'rate-limited'
    }
    if (this.config.sampleRate < 1 && this.random() >= this.config.sampleRate) {
      return 'sampled-out'
    }

    this.lastSent.set(fingerprint, now)
    this.sentAt.push(now)
    return 'send'
  }
}
