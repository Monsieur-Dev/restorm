/**
 * Crash recovery: reopen what the user was working on, and never let a file
 * that kills the app on open keep killing it.
 *
 * Two things are persisted across launches, in ONE record so they move
 * together:
 *
 * - `pendingPath` — what a crash-triggered relaunch should reopen. Written when
 *   the crash is handled, consumed by the next launch.
 * - `inFlight` — the loop marker. Written BEFORE an automatic open is attempted
 *   and cleared only once that launch has proven survivable. A launch that
 *   finds it still standing knows the previous launch opened a file and did not
 *   come back, and opens nothing.
 *
 * **The ordering is the entire protection.** The marker must be persisted
 * before the risky work and cleared after it succeeds; reversed, the marker is
 * never present when it matters, nothing ever detects a loop, and the failure
 * only surfaces for a user who is already locked out of their own app. So the
 * write is not left to the caller: `planStartupOpen` persists the marker itself
 * and hands back the path afterwards, which makes the correct order the only
 * order a caller can express.
 *
 * The marker covers EVERY automatic open, not only the ones this module drove.
 * A file poisonous enough to kill the app at launch does so whether the launch
 * came from a crash relaunch, from the user restarting by hand, or from the
 * ordinary "reopen last file" setting — and only the first of those would be
 * covered by a marker armed at crash time. An explicit `--open` is deliberately
 * NOT armed: the user asked for that file, by name, on this launch, and
 * silently ignoring it would be a worse failure than the one being prevented.
 *
 * Electron-free and port-injected, so the whole state machine is exercised
 * without a filesystem, a clock or an app.
 */

/** The persisted record. Absent entirely on a fresh install, which reads as
 * "no recovery pending, no loop" — the correct state for a first launch. */
export interface CrashRecoveryRecord {
  /** Path a crash-triggered relaunch should reopen, if one is pending. */
  pendingPath?: string
  /** True while an automatic open is unproven. See the ordering note above. */
  inFlight?: boolean
}

/** Where the record lives across launches. */
export interface CrashRecoveryStore {
  read(): CrashRecoveryRecord | null
  /** `null` clears the record entirely. */
  write(record: CrashRecoveryRecord | null): void
}

/** Which path a launch should open automatically, and why. */
export interface StartupOpenPlan {
  /** The path to open, or `null` to open nothing. */
  path: string | null
  source: 'cli' | 'recovery' | 'reopen' | 'none'
  /**
   * True when a file was suppressed because the previous launch died with one
   * open. It is the difference between "nothing to reopen" and "we refused to
   * reopen", and only the second is worth a log line — or telling the user
   * about.
   */
  loopFallback: boolean
  /**
   * The file that was withheld, when one was. A silently un-reopened file is a
   * "did it lose my work?" moment, so the user is told which file and why;
   * naming it is most of the reassurance.
   */
  withheldPath: string | null
}

export interface StartupOpenInput {
  /** An explicit `--open` argument, or `null`. */
  cliPath: string | null
  /** The `files:reopenLastFile` path, already setting-gated and existence-checked. */
  reopenPath: string | null
  record: CrashRecoveryRecord | null
}

/**
 * The decision itself, pure and total.
 *
 * Order matters and is deliberate:
 *
 * 1. An explicit `--open` wins outright and resets the recovery state. It is
 *    this launch's instruction, and it is not armed (see the module note).
 * 2. A standing marker means the previous automatic open never proved
 *    survivable ⇒ open nothing. This also suppresses the ordinary
 *    reopen-last-file path, which is the point: leaving that path alive would
 *    let the setting reopen the very file the marker exists to withhold, and
 *    the protection would be decorative.
 * 3. Otherwise a pending recovery path, else the reopen-last-file path.
 */
export function planStartupOpen(input: StartupOpenInput): {
  plan: StartupOpenPlan
  /** What must be persisted BEFORE the plan is acted on. `null` clears. */
  nextRecord: CrashRecoveryRecord | null
} {
  if (input.cliPath !== null) {
    return {
      plan: { path: input.cliPath, source: 'cli', loopFallback: false, withheldPath: null },
      nextRecord: null
    }
  }

  if (input.record?.inFlight === true) {
    return {
      plan: {
        path: null,
        source: 'none',
        loopFallback: true,
        // What WOULD have been opened. The pending path is usually already
        // consumed by the launch that crashed, so in practice this is the
        // reopen-last-file path — the one the user recognises.
        withheldPath: input.record.pendingPath ?? input.reopenPath
      },
      nextRecord: null
    }
  }

  const pending = input.record?.pendingPath
  const path = pending ?? input.reopenPath
  if (path === null) {
    return {
      plan: { path: null, source: 'none', loopFallback: false, withheldPath: null },
      nextRecord: null
    }
  }

  return {
    plan: {
      path,
      source: pending === undefined ? 'reopen' : 'recovery',
      loopFallback: false,
      withheldPath: null
    },
    // The marker, and ONLY the marker: the pending path has now been consumed,
    // so a launch that crashes before proving itself leaves behind "an
    // automatic open failed" rather than "try this path again".
    nextRecord: { inFlight: true }
  }
}

/**
 * The arguments to relaunch with: the current ones, minus any `--open`.
 *
 * Without this the protection has a hole big enough to drive the original bug
 * through. A relaunch inherits the process's arguments, so an app started as
 * `restorm --open X` relaunches as `restorm --open X` — and because an explicit
 * `--open` deliberately wins outright and is never armed, EVERY recovery launch
 * would reopen X through the command line, crash, and relaunch with the same
 * flag, forever. The marker would never be written and would never fire.
 *
 * Removing the flag is the honest fix rather than making the record outrank the
 * command line: this is a relaunch WE perform, so its arguments are ours to
 * choose, and the path to reopen already travels in the record. A user who
 * later types `--open` themselves still gets exactly the file they named.
 *
 * Both spellings and both separators, because yargs accepts all four and a
 * missed form is a silently reinstated loop.
 */
export function withoutOpenArg(args: string[]): string[] {
  const kept: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) continue
    if (arg === '--open' || arg === '-o') {
      // The value is a separate argument; dropping the flag alone would leave a
      // bare path behind.
      index += 1
      continue
    }
    if (arg.startsWith('--open=') || arg.startsWith('-o=')) continue
    kept.push(arg)
  }
  return kept
}

export interface CrashRecoveryServiceOptions {
  store: CrashRecoveryStore
  log?: ((message: string, fields?: Record<string, unknown>) => void) | undefined
}

export class CrashRecoveryService {
  /**
   * Set once this launch has handled a crash. It makes `markLaunchSurvived` a
   * no-op for the rest of the process's life, which closes a real race: the
   * recovery surface waits for the user to press a button, and the settle timer
   * would otherwise fire underneath them and clear the marker of the very
   * launch that just failed.
   */
  private crashed = false

  constructor(private readonly options: CrashRecoveryServiceOptions) {}

  /**
   * Decide what this launch should open, persisting the loop marker first.
   *
   * Call ONCE per launch, immediately before opening anything. The write
   * happens inside rather than being returned as an instruction, so there is no
   * call site that can perform the open and forget the marker.
   */
  planStartupOpen(input: Omit<StartupOpenInput, 'record'>): StartupOpenPlan {
    const record = this.read()
    const { plan, nextRecord } = planStartupOpen({ ...input, record })
    this.write(nextRecord)
    return plan
  }

  /**
   * This launch got far enough that reopening a file is demonstrably not what
   * kills it. Clears the marker.
   *
   * Deliberately inert after a crash has been handled: a launch that crashed
   * did not survive, whatever a timer scheduled earlier believes.
   */
  markLaunchSurvived(): void {
    if (this.crashed) return
    const record = this.read()
    if (record === null) return
    this.write(null)
  }

  /**
   * A crash has been handled and the app is about to relaunch. Records what the
   * next launch should reopen.
   *
   * The subtle case is a crash while the marker is already standing — this
   * launch WAS an unproven automatic open, and it has now failed. The marker
   * must be left exactly as it is: overwriting it with a fresh pending path
   * would tell the next launch to try the same file again, and the loop this
   * whole module exists to break would run forever, one relaunch at a time.
   */
  beginRecovery(path: string | null): void {
    const record = this.read()
    this.crashed = true
    if (record?.inFlight === true) {
      this.options.log?.('Crash recovery: an automatic open crashed; the next launch opens no file', {})
      return
    }
    this.write(path === null ? null : { pendingPath: path })
  }

  private read(): CrashRecoveryRecord | null {
    try {
      return this.options.store.read()
    } catch (error) {
      // An unreadable record must not be the thing that stops the app starting.
      // Treated as absent, which is the permissive branch — the alternative
      // (assume a loop) would withhold the user's file on a storage hiccup.
      this.options.log?.('Crash recovery state unreadable; treating it as absent', {
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  private write(record: CrashRecoveryRecord | null): void {
    try {
      this.options.store.write(record)
    } catch (error) {
      this.options.log?.('Crash recovery state could not be persisted', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
