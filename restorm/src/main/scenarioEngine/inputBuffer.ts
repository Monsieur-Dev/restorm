/**
 * Per-node, per-port token buffer that resolves the JOIN-by-lineage
 * activation rule.
 *
 * A node fires when:
 *   1. Every **required** input port has at least one buffered token, AND
 *   2. There exists a tuple of buffered tokens (one per port) whose
 *      scope stacks share a common ancestor — and we activate at the
 *      **deepest** such ancestor.
 *
 * Two scopes are JOIN-compatible iff one is a (non-strict) prefix of
 * the other. The "deepest common ancestor" then is just the longer
 * stack (or either, when both are equal).
 *
 * MERGE-port semantics (N edges feed the same input port) are handled
 * here too: any arriving token on a MERGE port re-activates the node
 * with its own latch value plus the latched values of the other
 * required ports — i.e. classic withLatestFrom.
 *
 * "Latching" means: an arrival on port P doesn't consume the buffered
 * tokens on other ports — those stay so a future arrival on P
 * re-activates without rejoining sibling tokens. This is the
 * `withLatestFrom` semantics from the ticket.
 */

import type { ScopeStack, Token } from './types'
import { scopeKey } from './scopeRegistry'

/** Per-port latch: keep all tokens (keyed by scope stack) so the
 * matcher can find a JOIN partner at the deepest common scope. */
type PortLatch = Map<string, Token>

export interface PortSpec {
  portId: string
  /** When `false`, the node can fire even without a value on this
   * port (the input is treated as `undefined`). Defaults to `true`. */
  required?: boolean
  /** When `true`, a fresh arrival on this port re-activates the node
   * even if every other port still has its previous latched value
   * (withLatestFrom). When `false`, the latch is shared and an
   * activation consumes the matched tuple. Defaults to `true` for
   * data ports (matches the editor's behaviour); `false` for the
   * implicit `header` flow port. */
  latch?: boolean
}

export interface FireDecision {
  /** Scope to fire at — the deepest common ancestor of the matched tuple. */
  scope: ScopeStack
  /** The token chosen for each port. The scheduler reads these values
   * (after deep-clone) into the activation's `inputs` map. */
  tokensByPort: Record<string, Token | undefined>
}

export class InputBuffer {
  /** ports[nodeId][portId] → latch of tokens (per scope). */
  private readonly latches = new Map<string, Map<string, PortLatch>>()
  private readonly portSpecs = new Map<string, PortSpec[]>()

  /** Register the input-port spec for a node. Called once per
   * scenario load — the spec drives the matcher's required / latch
   * logic. */
  registerNode(nodeId: string, ports: PortSpec[]): void {
    this.portSpecs.set(nodeId, ports)
    this.latches.set(nodeId, new Map(ports.map((p) => [p.portId, new Map<string, Token>()])))
  }

  /**
   * Buffer an incoming token on `(nodeId, portId)`. Returns the
   * activation decision when the node can fire (deepest-common-ancestor
   * scope + the matched token per port), or `null` if more tokens are
   * needed. The caller is the scheduler — it does NOT consume the
   * latches on read; consumption happens via `consume()`.
   */
  put(token: Token): FireDecision | null {
    const portMap = this.latches.get(token.toNodeId)
    if (!portMap) return null
    const portLatch = portMap.get(token.toPort)
    if (!portLatch) return null
    portLatch.set(scopeKey(token.scope), token)
    // Match must anchor on the new token — otherwise a node with N
    // latched values on port A keeps re-firing the same tuple every
    // time port B receives ANY new token. Anchoring guarantees the
    // newly-arrived token participates in the fire decision (or no
    // fire happens).
    return this.match(token.toNodeId, token)
  }

  /**
   * Consume the matched tuple from each latched port. For non-latch
   * ports (`latch: false`), the entry is deleted. For latch ports,
   * the value stays so a later arrival on another port can re-fire
   * with the same value (withLatestFrom).
   */
  consume(nodeId: string, decision: FireDecision): void {
    const portMap = this.latches.get(nodeId)
    if (!portMap) return
    const specs = this.portSpecs.get(nodeId) ?? []
    for (const spec of specs) {
      const t = decision.tokensByPort[spec.portId]
      if (!t) continue
      const portLatch = portMap.get(spec.portId)
      if (!portLatch) continue
      if (spec.latch === false) {
        portLatch.delete(scopeKey(t.scope))
      }
      // else: keep the latch so withLatestFrom re-fires on a later
      // arrival on another port.
    }
  }

  /** Compute the JOIN match anchored on the newly-arrived `arrival`
   * token. The arrival's port MUST be in the matched tuple; the
   * other ports pick from their latches the deepest-scope candidate
   * compatible with the arrival's scope. */
  private match(nodeId: string, arrival: Token): FireDecision | null {
    const specs = this.portSpecs.get(nodeId) ?? []
    const portMap = this.latches.get(nodeId)
    if (!portMap) return null
    const required = specs.filter((s) => s.required !== false)
    if (required.length === 0) return null
    const tokensByPort: Record<string, Token | undefined> = {}
    let fireScope: ScopeStack = arrival.scope
    for (const spec of required) {
      if (spec.portId === arrival.toPort) {
        tokensByPort[spec.portId] = arrival
        continue
      }
      const latch = portMap.get(spec.portId)
      if (!latch || latch.size === 0) return null
      const pick = pickCompatibleDeepest(latch, fireScope)
      if (!pick) return null
      tokensByPort[spec.portId] = pick
      fireScope = deeper(fireScope, pick.scope)
    }
    // Optional ports — same compatibility rule, absence is OK.
    for (const spec of specs) {
      if (spec.required !== false) continue
      const latch = portMap.get(spec.portId)
      if (!latch) continue
      const candidate = pickCompatibleDeepest(latch, fireScope)
      if (candidate) tokensByPort[spec.portId] = candidate
    }
    return { scope: fireScope, tokensByPort }
  }
}

/** A scope is JOIN-compatible with another iff one is a (non-strict)
 * prefix of the other. */
function isCompatible(a: ScopeStack, b: ScopeStack): boolean {
  const short = a.length < b.length ? a : b
  const long = a.length < b.length ? b : a
  for (let i = 0; i < short.length; i++) {
    const sf = short[i]
    const lf = long[i]
    if (!sf || !lf) return false
    if (sf.scopeNodeId !== lf.scopeNodeId || sf.index !== lf.index) return false
  }
  return true
}

/** Of two compatible stacks, the deeper one wins (it's the
 * descendant). */
function deeper(a: ScopeStack, b: ScopeStack): ScopeStack {
  return a.length >= b.length ? a : b
}

/** Pick the latched token whose scope is compatible with
 * `fireScope` and is the deepest such match. */
function pickCompatibleDeepest(latch: PortLatch, fireScope: ScopeStack): Token | undefined {
  let best: Token | undefined
  for (const tok of latch.values()) {
    if (!isCompatible(tok.scope, fireScope)) continue
    if (!best || tok.scope.length > best.scope.length) best = tok
  }
  return best
}
