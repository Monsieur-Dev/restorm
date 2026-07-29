/**
 * ConsentService — the main-process authority on "may this app send X?".
 *
 * It answers exactly one question, `canSend(gate)`, and keeps the audit trail
 * that makes the answer defensible: value + timestamp + the privacy-policy
 * version in force when the user decided. Nothing outbound and optional
 * (crash reports, telemetry, feedback) should reach the network without asking
 * it first, and nothing else in the app should re-derive the answer from the
 * raw setting — a single choke point is what makes "no consent, no traffic"
 * auditable rather than aspirational.
 *
 * The user-editable boolean stays in the settings store (so the Preferences
 * toggle drives it, with the store's own persistence + broadcast); this service
 * observes it and mirrors every transition into a small consent file. Deleting
 * that file loses only the audit trail, never the user's choice.
 *
 * `resolveOverride` is the seam for a gate whose value is not purely the user's
 * to make — a plan whose terms mandate or forbid a gate. The override wins over
 * the stored boolean, and `ConsentDecision.source` reports that it did, so the
 * UI can explain a value the user did not pick instead of silently contradicting
 * their toggle.
 *
 * Electron-free and port-injected (settings + store), so the whole decision
 * table is unit-testable without a running app.
 */

import type {
  ConsentDecision,
  ConsentGateDefinition,
  ConsentOverride,
  ConsentSource,
  PersistedConsentEntry,
  PersistedConsentFile
} from '../../../shared/privacy/consent'

/** The slice of a settings store this needs. Adapted by the host app over its
 * own service (ECUI's `SettingsService` fits directly). */
export interface ConsentSettingsPort {
  /** Current boolean for a storage key, or `undefined` when unset / non-boolean. */
  getBoolean(key: string): boolean | undefined
  /** Persist a new boolean for a storage key. */
  setBoolean(key: string, value: boolean): void
  /** Observe changes to one key. Returns an unsubscribe function. */
  subscribe(key: string, listener: () => void): () => void
}

/** Persistence port for the audit file. Synchronous by design — the consent
 * answer is read on hot paths and must never be a promise. */
export interface ConsentStorePort {
  /** File contents, or `null` when absent / unreadable. */
  read(): string | null
  /** Overwrite the file. Failures must be swallowed by the adapter — a
   * read-only disk degrades the audit trail, it must not break the app. */
  write(contents: string): void
}

export interface ConsentServiceOptions {
  /** The gates this app declares. Ids must be unique. */
  gates: readonly ConsentGateDefinition[]
  settings: ConsentSettingsPort
  store: ConsentStorePort
  /** Version string of the privacy policy currently in force. Stamped into
   * every recorded decision. */
  policyVersion: string
  /** Optional host override per gate (e.g. plan-mandated). Called on every
   * resolution, so it may read live state. */
  resolveOverride?: ((gateId: string) => ConsentOverride) | undefined
  /** Clock seam for tests. */
  now?: (() => Date) | undefined
  /** Optional warn sink for a malformed consent file. */
  log?: ((message: string, fields?: Record<string, unknown>) => void) | undefined
}

export class ConsentService {
  private readonly gates: Map<string, ConsentGateDefinition>
  private readonly options: ConsentServiceOptions
  private readonly unsubscribes: (() => void)[] = []
  private readonly listeners = new Set<(decisions: ConsentDecision[]) => void>()
  private entries: Record<string, PersistedConsentEntry>

  constructor(options: ConsentServiceOptions) {
    this.options = options
    this.gates = new Map(options.gates.map((g) => [g.id, g]))
    this.entries = this.load()
    for (const gate of options.gates) {
      this.unsubscribes.push(
        options.settings.subscribe(gate.settingKey, () => { this.onSettingChanged(gate) })
      )
    }
    // Stamp the audit trail for any gate whose stored boolean already differs
    // from what was last recorded (a settings.json edited by hand, a file
    // restored from a backup, a first run with a non-default default).
    this.reconcile()
  }

  /**
   * The one question that matters. `true` ⇒ the corresponding payload may leave
   * the process. An UNKNOWN gate is `false`: a typo'd gate name must fail
   * closed, never open.
   */
  canSend(gateId: string): boolean {
    const gate = this.gates.get(gateId)
    if (gate === undefined) return false
    return this.resolve(gate).granted
  }

  /** Full resolved state of one gate (value + audit trail + provenance).
   * Returns `null` for an unknown gate. */
  getDecision(gateId: string): ConsentDecision | null {
    const gate = this.gates.get(gateId)
    if (gate === undefined) return null
    return this.resolve(gate)
  }

  /** Every declared gate's decision, in declaration order. */
  listDecisions(): ConsentDecision[] {
    return this.options.gates.map((gate) => this.resolve(gate))
  }

  /**
   * Grant or revoke a gate programmatically (a consent dialog's buttons). Writes
   * the settings boolean, which fans back through the subscription and stamps
   * the audit trail. No-op for an unknown gate.
   */
  setGranted(gateId: string, granted: boolean): void {
    const gate = this.gates.get(gateId)
    if (gate === undefined) return
    this.options.settings.setBoolean(gate.settingKey, granted)
    // Not every settings implementation notifies synchronously (or at all when
    // the value is unchanged), so record here too — `record` is idempotent on an
    // unchanged value. Notify on the same condition: skipping it would move the
    // audit trail while leaving the firewall exemption on the previous answer.
    if (this.record(gate)) this.notify()
  }

  /** Revoke a gate. Sugar for `setGranted(gateId, false)`, named for the right
   * the user is exercising. */
  revoke(gateId: string): void {
    this.setGranted(gateId, false)
  }

  /** Observe consent transitions (e.g. to reconcile a firewall exemption).
   * Fires after the audit trail is written. Returns an unsubscribe function. */
  onChange(listener: (decisions: ConsentDecision[]) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Drop every settings subscription (app teardown / test reset). */
  dispose(): void {
    for (const off of this.unsubscribes) off()
    this.unsubscribes.length = 0
    this.listeners.clear()
  }

  // -------------------------------------------------------------------------

  private storedValue(gate: ConsentGateDefinition): boolean {
    return this.options.settings.getBoolean(gate.settingKey) ?? gate.defaultGranted
  }

  private resolve(gate: ConsentGateDefinition): ConsentDecision {
    const entry = this.entries[gate.id]
    const override = this.options.resolveOverride?.(gate.id) ?? null
    const stored = this.storedValue(gate)
    let granted = stored
    let source: ConsentSource = entry === undefined ? 'default' : 'user'
    if (override === 'forced-on') { granted = true; source = 'forced-on' }
    if (override === 'forced-off') { granted = false; source = 'forced-off' }
    return {
      gate: gate.id,
      granted,
      consentedAt: entry?.consentedAt ?? null,
      policyVersion: entry?.policyVersion ?? null,
      source
    }
  }

  private onSettingChanged(gate: ConsentGateDefinition): void {
    this.record(gate)
    this.notify()
  }

  /**
   * Stamp the audit trail for `gate` when its stored boolean differs from what
   * was last recorded. Returns `true` when the file changed.
   *
   * Two deliberate non-behaviours. The override is NOT recorded — the trail
   * must capture what the USER chose, not what a plan imposed on top of it, or
   * a plan downgrade would rewrite history. And a bumped `policyVersion` does
   * NOT re-stamp an unchanged value — leaving the stale version visible is
   * precisely what lets the host detect "consented to an older policy" and
   * re-ask, instead of silently laundering the old consent into the new terms.
   */
  private record(gate: ConsentGateDefinition): boolean {
    const stored = this.storedValue(gate)
    if (this.entries[gate.id]?.granted === stored) return false
    const now = (this.options.now ?? ((): Date => new Date()))()
    this.entries = {
      ...this.entries,
      [gate.id]: {
        granted: stored,
        consentedAt: now.toISOString(),
        policyVersion: this.options.policyVersion
      }
    }
    this.persist()
    return true
  }

  /**
   * Boot-time catch-up for a stored boolean this service never saw change: a
   * settings file edited by hand, restored from a backup, or written by a build
   * that predates the consent file. A gate still sitting on its default with no
   * entry is left UNRECORDED on purpose — `source: 'default'` (nobody decided)
   * must stay distinguishable from `source: 'user'` (someone did).
   */
  private reconcile(): void {
    let changed = false
    for (const gate of this.options.gates) {
      const entry = this.entries[gate.id]
      const stored = this.storedValue(gate)
      if (entry === undefined && stored === gate.defaultGranted) continue
      if (this.record(gate)) changed = true
    }
    if (changed) this.notify()
  }

  private notify(): void {
    const decisions = this.listDecisions()
    for (const listener of Array.from(this.listeners)) {
      try { listener(decisions) } catch { /* a listener must never break consent */ }
    }
  }

  private load(): Record<string, PersistedConsentEntry> {
    const raw = this.options.store.read()
    if (raw === null) return {}
    try {
      // Parsed as `unknown` on purpose: the file is user-writable, so its shape
      // is a claim to validate, not a type to trust.
      const parsed = JSON.parse(raw) as { gates?: unknown }
      const gates: unknown = parsed.gates
      if (typeof gates !== 'object' || gates === null) return {}
      const out: Record<string, PersistedConsentEntry> = {}
      for (const [id, value] of Object.entries(gates as Record<string, unknown>)) {
        const entry = value as Partial<PersistedConsentEntry>
        if (
          typeof entry.granted !== 'boolean' ||
          typeof entry.consentedAt !== 'string' ||
          typeof entry.policyVersion !== 'string'
        ) continue
        out[id] = { granted: entry.granted, consentedAt: entry.consentedAt, policyVersion: entry.policyVersion }
      }
      return out
    } catch {
      this.options.log?.('ConsentService: consent file is unreadable, starting a fresh audit trail')
      return {}
    }
  }

  private persist(): void {
    const file: PersistedConsentFile = { version: 1, gates: this.entries }
    this.options.store.write(`${JSON.stringify(file, null, 2)}\n`)
  }
}
