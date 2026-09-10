/**
 * The last thing that touches a crash payload before it leaves the process.
 *
 * Sentry's `beforeSend` / `beforeBreadcrumb` hooks are the only place where the
 * FINAL event exists — after the SDK has assembled the exception, the stack, the
 * breadcrumb trail and every integration's contribution. Scrubbing anywhere
 * earlier would leave whatever the SDK adds afterwards unscrubbed, which is
 * exactly how a crash reporter leaks the `Authorization` header of the request
 * that crashed.
 *
 * Both hooks do the same two things, in this order:
 *   1. `scrubPayload` rewrites the event.
 *   2. `assertScrubbed` re-checks it and THROWS if anything survived.
 *
 * Step 2 is the point. It is not a second opinion on step 1 — it is the gate
 * that decides whether the event is allowed to exist. A throw means DROP: the
 * hook returns `null` and the SDK discards the event entirely. So a future
 * change that introduces a leak costs us a missing crash report, never a leaked
 * secret. For a privacy-first API client that trade is not close.
 *
 * Deliberately pure and SDK-type-light (structural `CrashEvent` /
 * `CrashBreadcrumb` shapes rather than `@sentry/electron`'s types) so the whole
 * decision table is unit-testable without booting Electron or the SDK.
 */

import { homedir } from 'node:os'
import { scrubPayload, assertScrubbed, type ScrubOptions } from 'electron-core-ui/main'

/** The subset of a Sentry event this module reasons about. Structural on
 * purpose — the SDK's own `Event` type is enormous and mostly irrelevant here,
 * and the scrubber walks whatever it is given. */
export type CrashEvent = Record<string, unknown>

/** The subset of a Sentry breadcrumb this module reasons about. */
export type CrashBreadcrumb = Record<string, unknown>

/** Sink for the "we dropped an event" signal. Deliberately not the event itself
 * — logging a payload we just refused to send would defeat the point. */
export type ScrubFailureLogger = (message: string, fields: Record<string, unknown>) => void

export interface CrashScrubOptions {
  /** Overrides for the generic scrubber. The defaults below are the policy. */
  scrub?: ScrubOptions | undefined
  /** Called when an event is dropped because it failed the fail-closed gate. */
  onDropped?: ScrubFailureLogger | undefined
}

/**
 * The scrubbing policy for crash payloads.
 *
 * `urlPolicy: 'strip'` — an internal hostname is itself sensitive for this
 * product's users, so destinations go entirely rather than host-only.
 * `homeDir` — collapses the user's home to `~`, which removes the username (the
 * actual PII) while keeping stack frames readable, the one place the module
 * deliberately favours debuggability.
 */
export function crashScrubOptions(overrides: ScrubOptions = {}): ScrubOptions {
  return {
    urlPolicy: 'strip',
    homeDir: safeHomedir(),
    // Sentry's own structural identifiers are 32-hex random ids — the exact
    // shape the entropy catch-all treats as a secret. Redacting them corrupts
    // the identifiers the ingest endpoint validates: an event whose `event_id`
    // is `[redacted-token]` is rejected with HTTP 400, so scrubbing them drops
    // EVERY crash report instead of protecting anything. They are SDK-generated
    // ids, not user content, so they pass through verbatim. `span_id` is 16-hex
    // (below the catch-all's 32-char floor) but is listed for parity so the
    // policy reads as "the Sentry trace identifiers", not "the ones that happen
    // to trip the rule today".
    preserveKeys: ['event_id', 'trace_id', 'span_id'],
    // Defence-in-depth for a privacy-first client: cap any single string in the
    // payload so bulk user content — a whole imported OpenAPI/AsyncAPI spec, a
    // pasted document, a large response body — can't ride into a crash report in
    // one field. The secret/URL detectors match shapes, not size, so a 250 KB
    // spec would otherwise sail through. 4 KB keeps stack frames, messages and
    // breadcrumb URLs fully intact (all far shorter) while truncating anything
    // document-sized to a stub. The primary guard is that handled import errors
    // never reach Sentry at all; this is the belt to that suspenders.
    maxStringLength: 4096,
    ...overrides
  }
}

/** `os.homedir()` throws on a machine with no resolvable home (some CI
 * sandboxes). A missing home just means the platform-shape path rules do the
 * work alone, so degrade rather than take the crash reporter down with it. */
function safeHomedir(): string | undefined {
  try {
    const home = homedir()
    return home === '' ? undefined : home
  } catch {
    return undefined
  }
}

/**
 * Build Sentry's `beforeSend`. Returns the scrubbed event, or `null` to drop it
 * when anything survived scrubbing.
 */
export function makeBeforeSend(
  options: CrashScrubOptions = {}
): (event: CrashEvent) => CrashEvent | null {
  const scrubOptions = crashScrubOptions(options.scrub)
  return (event) => scrubOrDrop(event, scrubOptions, 'event', options.onDropped)
}

/**
 * Build Sentry's `beforeBreadcrumb`. Breadcrumbs are the richest leak vector in
 * the whole payload — the SDK records every HTTP call the app made, URL and all
 * — so they go through the identical gate.
 */
export function makeBeforeBreadcrumb(
  options: CrashScrubOptions = {}
): (breadcrumb: CrashBreadcrumb) => CrashBreadcrumb | null {
  const scrubOptions = crashScrubOptions(options.scrub)
  return (breadcrumb) => scrubOrDrop(breadcrumb, scrubOptions, 'breadcrumb', options.onDropped)
}

function scrubOrDrop<T>(
  payload: T,
  scrubOptions: ScrubOptions,
  kind: 'event' | 'breadcrumb',
  onDropped: ScrubFailureLogger | undefined
): T | null {
  let scrubbed: unknown
  try {
    scrubbed = scrubPayload(payload, scrubOptions)
    assertScrubbed(scrubbed, scrubOptions)
  } catch (error) {
    // Includes a scrubber that threw outright: an unknown failure mode is not a
    // licence to send the raw payload.
    onDropped?.(`Crash ${kind} dropped: it did not pass the scrubbing gate`, {
      kind,
      reason: error instanceof Error ? error.message : String(error)
    })
    return null
  }
  return scrubbed as T
}
