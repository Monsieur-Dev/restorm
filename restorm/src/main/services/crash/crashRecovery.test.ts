import { describe, it, expect } from 'vitest'
import {
  CrashRecoveryService,
  planStartupOpen,
  withoutOpenArg,
  type CrashRecoveryRecord,
  type CrashRecoveryStore
} from './crashRecovery'

/**
 * A store that survives the service instance, so a "launch" can be simulated by
 * building a NEW service over the same disk state — which is the only way to
 * test a protection whose whole subject is what one launch leaves behind for
 * the next.
 */
class FakeDisk implements CrashRecoveryStore {
  private record: CrashRecoveryRecord | null = null
  /** Every write in order, for asserting WHEN the marker was persisted. */
  readonly writes: (CrashRecoveryRecord | null)[] = []

  read(): CrashRecoveryRecord | null {
    return this.record
  }

  write(record: CrashRecoveryRecord | null): void {
    this.record = record
    this.writes.push(record)
  }

  /** Simulate a fresh process over the same persisted state. */
  launch(): CrashRecoveryService {
    return new CrashRecoveryService({ store: this })
  }
}

const NO_CLI = { cliPath: null, reopenPath: null }

describe('planStartupOpen', () => {
  it('opens an explicit --open path and does not arm the marker', () => {
    const { plan, nextRecord } = planStartupOpen({
      cliPath: '/tmp/a.restorm',
      reopenPath: null,
      record: null
    })
    expect(plan).toEqual({ path: '/tmp/a.restorm', source: 'cli', loopFallback: false, withheldPath: null })
    expect(nextRecord).toBeNull()
  })

  it('lets an explicit --open through even with a standing marker', () => {
    // The marker can only have been armed by an AUTOMATIC open, so it says
    // nothing about the file the user has just named on the command line.
    const { plan } = planStartupOpen({
      cliPath: '/tmp/a.restorm',
      reopenPath: null,
      record: { inFlight: true }
    })
    expect(plan.path).toBe('/tmp/a.restorm')
  })

  it('arms the marker when it reopens the last file', () => {
    const { plan, nextRecord } = planStartupOpen({
      cliPath: null,
      reopenPath: '/tmp/last.restorm',
      record: null
    })
    expect(plan).toEqual({ path: '/tmp/last.restorm', source: 'reopen', loopFallback: false, withheldPath: null })
    expect(nextRecord).toEqual({ inFlight: true })
  })

  it('prefers a pending recovery path over the reopen-last-file path', () => {
    const { plan } = planStartupOpen({
      cliPath: null,
      reopenPath: '/tmp/last.restorm',
      record: { pendingPath: '/tmp/crashed.restorm' }
    })
    expect(plan).toEqual({ path: '/tmp/crashed.restorm', source: 'recovery', loopFallback: false, withheldPath: null })
  })

  it('consumes the pending path, leaving only the marker behind', () => {
    // If the pending path survived into the next record, a launch that crashed
    // before proving itself would tell its successor to try the same file.
    const { nextRecord } = planStartupOpen({
      cliPath: null,
      reopenPath: null,
      record: { pendingPath: '/tmp/crashed.restorm' }
    })
    expect(nextRecord).toEqual({ inFlight: true })
  })

  it('opens nothing, and clears, when the marker is standing', () => {
    const { plan, nextRecord } = planStartupOpen({
      cliPath: null,
      reopenPath: '/tmp/last.restorm',
      record: { inFlight: true }
    })
    expect(plan).toEqual({ path: null, source: 'none', loopFallback: true, withheldPath: '/tmp/last.restorm' })
    expect(nextRecord).toBeNull()
  })

  it('suppresses the reopen-last-file path too, not just the recovery path', () => {
    // The one a reviewer would miss: leaving the ordinary setting alive would
    // let it reopen the exact file the marker exists to withhold.
    const { plan } = planStartupOpen({
      cliPath: null,
      reopenPath: '/tmp/poison.restorm',
      record: { inFlight: true, pendingPath: '/tmp/poison.restorm' }
    })
    expect(plan.path).toBeNull()
  })

  it('names the file it withheld, so the user can be told which one', () => {
    // An app that starts empty on purpose looks exactly like one that lost the
    // user's work. The name is most of the reassurance.
    expect(planStartupOpen({
      cliPath: null,
      reopenPath: '/tmp/poison.restorm',
      record: { inFlight: true }
    }).plan.withheldPath).toBe('/tmp/poison.restorm')

    // A pending path that was never consumed wins, being the more specific.
    expect(planStartupOpen({
      cliPath: null,
      reopenPath: '/tmp/last.restorm',
      record: { inFlight: true, pendingPath: '/tmp/crashed.restorm' }
    }).plan.withheldPath).toBe('/tmp/crashed.restorm')
  })

  it('opens nothing on a fresh install', () => {
    const { plan, nextRecord } = planStartupOpen({ ...NO_CLI, record: null })
    expect(plan).toEqual({ path: null, source: 'none', loopFallback: false, withheldPath: null })
    expect(nextRecord).toBeNull()
  })
})

describe('CrashRecoveryService — marker ordering', () => {
  it('persists the marker BEFORE handing back the path', () => {
    // The ordering trap, asserted directly: at the instant the caller learns
    // which file to open, the marker is already on disk. Reversed, the marker
    // would only ever be written after the work that can prevent it being
    // written at all.
    const disk = new FakeDisk()
    const plan = disk.launch().planStartupOpen({ cliPath: null, reopenPath: '/tmp/last.restorm' })

    expect(plan.path).toBe('/tmp/last.restorm')
    expect(disk.read()).toEqual({ inFlight: true })
    expect(disk.writes).toEqual([{ inFlight: true }])
  })

  it('withholds the file from the next launch when this one never survived', () => {
    // The behavioural proof, and the one that fails if the ordering is
    // reversed: no `markLaunchSurvived`, so the marker stands.
    const disk = new FakeDisk()
    expect(disk.launch().planStartupOpen({ cliPath: null, reopenPath: '/tmp/poison.restorm' }).path)
      .toBe('/tmp/poison.restorm')

    const second = disk.launch().planStartupOpen({ cliPath: null, reopenPath: '/tmp/poison.restorm' })
    expect(second.path).toBeNull()
    expect(second.loopFallback).toBe(true)
  })

  it('reopens normally again once a launch has survived', () => {
    const disk = new FakeDisk()
    const first = disk.launch()
    first.planStartupOpen({ cliPath: null, reopenPath: '/tmp/last.restorm' })
    first.markLaunchSurvived()
    expect(disk.read()).toBeNull()

    expect(disk.launch().planStartupOpen({ cliPath: null, reopenPath: '/tmp/last.restorm' }).path)
      .toBe('/tmp/last.restorm')
  })

  it('does not clear the marker after a crash has been handled', () => {
    // The settle timer fires on a schedule set before the crash. It must not
    // erase the marker of the launch that just failed while the recovery
    // surface is still waiting for the user.
    const disk = new FakeDisk()
    const service = disk.launch()
    service.planStartupOpen({ cliPath: null, reopenPath: '/tmp/poison.restorm' })
    service.beginRecovery('/tmp/poison.restorm')
    service.markLaunchSurvived()

    expect(disk.read()).toEqual({ inFlight: true })
  })
})

describe('CrashRecoveryService — recovery relaunch', () => {
  it('records the crashed file for the next launch', () => {
    const disk = new FakeDisk()
    disk.launch().beginRecovery('/tmp/work.restorm')
    expect(disk.read()).toEqual({ pendingPath: '/tmp/work.restorm' })

    expect(disk.launch().planStartupOpen(NO_CLI)).toEqual({
      path: '/tmp/work.restorm',
      source: 'recovery',
      loopFallback: false,
      withheldPath: null
    })
  })

  it('clears the record when nothing was open at the crash', () => {
    const disk = new FakeDisk()
    disk.launch().beginRecovery(null)
    expect(disk.read()).toBeNull()
  })

  it('leaves a standing marker alone when the recovery launch itself crashes', () => {
    // Two crashes in a row on the same file. Overwriting the marker with a
    // fresh pending path here is what would turn the protection into an
    // infinite relaunch loop, one launch at a time.
    const disk = new FakeDisk()
    disk.launch().beginRecovery('/tmp/poison.restorm')

    const recovery = disk.launch()
    expect(recovery.planStartupOpen(NO_CLI).path).toBe('/tmp/poison.restorm')
    recovery.beginRecovery('/tmp/poison.restorm')

    const third = disk.launch().planStartupOpen(NO_CLI)
    expect(third.path).toBeNull()
    expect(third.loopFallback).toBe(true)
  })

  it('recovers a file again after an intervening healthy launch', () => {
    const disk = new FakeDisk()
    const recovery = disk.launch()
    recovery.beginRecovery('/tmp/work.restorm')

    const second = disk.launch()
    expect(second.planStartupOpen(NO_CLI).path).toBe('/tmp/work.restorm')
    second.markLaunchSurvived()
    second.beginRecovery('/tmp/work.restorm')

    expect(disk.launch().planStartupOpen(NO_CLI).path).toBe('/tmp/work.restorm')
  })
})

describe('withoutOpenArg', () => {
  it('drops --open and the path that follows it', () => {
    expect(withoutOpenArg(['.', '--open', '/tmp/a.restorm', '--inactive-window']))
      .toEqual(['.', '--inactive-window'])
  })

  it('drops every spelling yargs accepts', () => {
    // A missed form is a silently reinstated crash loop, so all four are pinned.
    expect(withoutOpenArg(['--open=/tmp/a.restorm'])).toEqual([])
    expect(withoutOpenArg(['-o=/tmp/a.restorm'])).toEqual([])
    expect(withoutOpenArg(['-o', '/tmp/a.restorm'])).toEqual([])
    expect(withoutOpenArg(['--open', '/tmp/a.restorm'])).toEqual([])
  })

  it('leaves everything else alone', () => {
    const args = ['.', '--mcp-session-name', 'x', '--inactive-window']
    expect(withoutOpenArg(args)).toEqual(args)
  })

  it('closes the loop a relaunched --open would otherwise reopen', () => {
    // The whole point, as a scenario: the relaunch carries no --open, so the
    // next launch is governed by the record and the marker actually arms.
    const relaunchArgs = withoutOpenArg(['.', '--open', '/tmp/poison.restorm'])
    const cliPath = relaunchArgs.includes('--open') ? '/tmp/poison.restorm' : null

    const disk = new FakeDisk()
    disk.launch().beginRecovery('/tmp/poison.restorm')

    const recovery = disk.launch()
    expect(recovery.planStartupOpen({ cliPath, reopenPath: null }).path).toBe('/tmp/poison.restorm')
    recovery.beginRecovery('/tmp/poison.restorm')

    expect(disk.launch().planStartupOpen({ cliPath, reopenPath: null }).path).toBeNull()
  })
})

describe('CrashRecoveryService — a broken store cannot stop the app', () => {
  const exploding: CrashRecoveryStore = {
    read: () => { throw new Error('disk gone') },
    write: () => { throw new Error('disk gone') }
  }

  it('opens the file it was asked for when the record cannot be read', () => {
    const service = new CrashRecoveryService({ store: exploding })
    expect(service.planStartupOpen({ cliPath: null, reopenPath: '/tmp/last.restorm' }).path)
      .toBe('/tmp/last.restorm')
  })

  it('does not throw out of any entry point', () => {
    const service = new CrashRecoveryService({ store: exploding })
    expect(() => { service.beginRecovery('/tmp/a.restorm') }).not.toThrow()
    expect(() => { service.markLaunchSurvived() }).not.toThrow()
  })
})
