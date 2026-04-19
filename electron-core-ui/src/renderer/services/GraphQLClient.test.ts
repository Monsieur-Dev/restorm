/**
 * State-machine tests for the renderer-side GraphQL link-status tracking.
 *
 * We don't spin up a real SSE client — we intercept the `on` event
 * listeners passed to `createClient(...)` via a vitest module mock and
 * replay `connecting(true)` / `connected(true)` callbacks by hand. That
 * isolates the status transitions (which is what we actually care about)
 * from the transport layer. An injectable clock
 * (`setClockForTests`) keeps the time-based `reconnecting → failed`
 * escalation deterministic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { EventListeners } from 'graphql-sse'

let capturedListeners: EventListeners | undefined

vi.mock('graphql-sse', () => ({
  createClient: vi.fn((options: { on?: EventListeners }) => {
    capturedListeners = options.on
    return {
      subscribe: vi.fn(() => (): void => { /* noop dispose */ }),
      iterate: vi.fn(),
      dispose: vi.fn()
    }
  })
}))

// Import AFTER the mock registration so `createClient` is already the mock.
import { graphQLClient, type GraphQLLinkStatus } from './GraphQLClient'
import { FAILED_AFTER_RECONNECTING_MS } from './graphqlLinkStatus'

function emitConnecting(reconnecting: boolean): void {
  capturedListeners?.connecting?.(reconnecting)
}
function emitConnected(reconnected: boolean): void {
  capturedListeners?.connected?.(reconnected)
}

describe('GraphQLClient link-status state machine', () => {
  let currentTime = 0

  beforeEach(() => {
    currentTime = 1_000_000 // arbitrary non-zero epoch
    capturedListeners = undefined
    graphQLClient.initialize({ endpoint: 'http://test.local/graphql' })
    graphQLClient.setClockForTests(() => currentTime)
    // Force a known-good baseline by replaying the first real connect.
    emitConnected(false)
  })

  afterEach(() => {
    // Reset the clock injection so unrelated tests aren't affected.
    graphQLClient.setClockForTests(Date.now)
  })

  it('starts in the ok state', () => {
    expect(graphQLClient.getLinkStatus()).toBe<GraphQLLinkStatus>('ok')
  })

  it('transitions to reconnecting on the first reconnect attempt', () => {
    emitConnecting(true)
    expect(graphQLClient.getLinkStatus()).toBe<GraphQLLinkStatus>('reconnecting')
  })

  it('returns to ok after a successful reconnect', () => {
    emitConnecting(true)
    emitConnected(true)
    expect(graphQLClient.getLinkStatus()).toBe<GraphQLLinkStatus>('ok')
  })

  it('escalates to failed once the reconnecting window exceeds FAILED_AFTER_RECONNECTING_MS', () => {
    emitConnecting(true)
    expect(graphQLClient.getLinkStatus()).toBe<GraphQLLinkStatus>('reconnecting')
    currentTime += FAILED_AFTER_RECONNECTING_MS
    // Retry attempts keep firing under the hood — any further
    // `connecting(true)` after the threshold escalates.
    emitConnecting(true)
    expect(graphQLClient.getLinkStatus()).toBe<GraphQLLinkStatus>('failed')
  })

  it('stays reconnecting just below the escalation threshold', () => {
    emitConnecting(true)
    currentTime += FAILED_AFTER_RECONNECTING_MS - 1
    emitConnecting(true)
    expect(graphQLClient.getLinkStatus()).toBe<GraphQLLinkStatus>('reconnecting')
  })

  it('does not escalate when the per-subscription fan-out of connecting events is rapid', () => {
    // graphql-sse emits `connecting(true)` once per subscription in
    // distinct-connections mode, so a single real outage produces 6
    // events from 6 subscriptions. Time-based escalation shrugs this
    // off — all 6 events happen at t=reconnectingSince and don't
    // advance the clock.
    for (let i = 0; i < 20; i += 1) emitConnecting(true)
    expect(graphQLClient.getLinkStatus()).toBe<GraphQLLinkStatus>('reconnecting')
  })

  it('recovers from failed back to ok on a successful reconnect', () => {
    emitConnecting(true)
    currentTime += FAILED_AFTER_RECONNECTING_MS
    emitConnecting(true)
    expect(graphQLClient.getLinkStatus()).toBe<GraphQLLinkStatus>('failed')
    emitConnected(true)
    expect(graphQLClient.getLinkStatus()).toBe<GraphQLLinkStatus>('ok')
  })

  it('resets the reconnecting timer after a successful reconnect', () => {
    emitConnecting(true)
    currentTime += FAILED_AFTER_RECONNECTING_MS - 1
    emitConnected(true)
    // Timer reset; the next `connecting(true)` starts a new window
    // from `currentTime`, so even a tiny additional advance stays in
    // the reconnecting state rather than jumping to failed.
    currentTime += 1
    emitConnecting(true)
    expect(graphQLClient.getLinkStatus()).toBe<GraphQLLinkStatus>('reconnecting')
  })
})

describe('GraphQLClient.initialize re-entry', () => {
  it('disposes the previous SSE client and resets state on re-init', () => {
    let currentTime = 5_000_000
    graphQLClient.initialize({ endpoint: 'http://first.local/graphql' })
    graphQLClient.setClockForTests(() => currentTime)
    emitConnected(false)
    emitConnecting(true)
    currentTime += FAILED_AFTER_RECONNECTING_MS
    emitConnecting(true)
    expect(graphQLClient.getLinkStatus()).toBe<GraphQLLinkStatus>('failed')

    // Re-init clears the failed state even though we don't manually
    // replay a successful connect — the timer is reset and status
    // returns to ok.
    graphQLClient.initialize({ endpoint: 'http://second.local/graphql' })
    graphQLClient.setClockForTests(Date.now)
    expect(graphQLClient.getLinkStatus()).toBe<GraphQLLinkStatus>('ok')
  })
})

describe('GraphQLClient.onLinkStatusChange', () => {
  let currentTime = 0

  beforeEach(() => {
    currentTime = 1_000_000
    capturedListeners = undefined
    graphQLClient.initialize({ endpoint: 'http://test.local/graphql' })
    graphQLClient.setClockForTests(() => currentTime)
    emitConnected(false)
  })

  afterEach(() => {
    graphQLClient.setClockForTests(Date.now)
  })

  it('fires the listener on each transition', () => {
    const events: GraphQLLinkStatus[] = []
    const unsubscribe = graphQLClient.onLinkStatusChange((s) => events.push(s))

    emitConnecting(true) // ok → reconnecting
    emitConnected(true) // reconnecting → ok
    emitConnecting(true) // ok → reconnecting
    currentTime += FAILED_AFTER_RECONNECTING_MS
    emitConnecting(true) // reconnecting → failed
    emitConnected(true) // failed → ok

    unsubscribe()
    expect(events).toEqual<GraphQLLinkStatus[]>([
      'reconnecting',
      'ok',
      'reconnecting',
      'failed',
      'ok'
    ])
  })

  it('stops notifying after unsubscribe', () => {
    const events: GraphQLLinkStatus[] = []
    const unsubscribe = graphQLClient.onLinkStatusChange((s) => events.push(s))
    emitConnecting(true)
    expect(events).toEqual<GraphQLLinkStatus[]>(['reconnecting'])
    unsubscribe()
    emitConnected(true)
    emitConnecting(true)
    expect(events).toEqual<GraphQLLinkStatus[]>(['reconnecting'])
  })
})
