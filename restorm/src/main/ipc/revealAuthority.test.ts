import { describe, it, expect } from 'vitest'
import { isRevealablePath, type RevealAuthority } from './revealAuthority'

const OPEN_PROJECT = '/home/user/projects/current/open.restorm'
const RECENT_A = '/home/user/projects/archive/alpha.restorm'
const RECENT_B = '/home/user/elsewhere/beta.restorm'

const authority = (over: Partial<RevealAuthority> = {}): RevealAuthority => ({
  openProjectPath: OPEN_PROJECT,
  recentPaths: [RECENT_A, RECENT_B],
  ...over
})

describe('reveal authority', () => {
  it('allows the currently open project', () => {
    expect(isRevealablePath(OPEN_PROJECT, authority())).toBe(true)
  })

  it('allows a file the main process tracks as recent', () => {
    expect(isRevealablePath(RECENT_A, authority())).toBe(true)
    expect(isRevealablePath(RECENT_B, authority())).toBe(true)
  })

  it('allows a tracked recent while no project is open at all', () => {
    // The welcome screen's case: the list is populated, nothing is loaded.
    expect(isRevealablePath(RECENT_A, authority({ openProjectPath: null }))).toBe(true)
  })

  it('refuses a path that is neither the open project nor tracked', () => {
    expect(isRevealablePath('/etc/passwd', authority())).toBe(false)
    expect(isRevealablePath('/home/user/secrets/keys.txt', authority())).toBe(false)
  })

  it('refuses everything when there is no authority to check against', () => {
    const empty = authority({ openProjectPath: null, recentPaths: [] })
    expect(isRevealablePath(OPEN_PROJECT, empty)).toBe(false)
    expect(isRevealablePath(RECENT_A, empty)).toBe(false)
  })

  it('matches exactly — a parent, a sibling or an extended path is refused', () => {
    // The whole point of exact equality: none of these may ride in on the
    // back of an allowed entry.
    expect(isRevealablePath('/home/user/projects/archive', authority())).toBe(false)
    expect(isRevealablePath('/home/user/projects/archive/', authority())).toBe(false)
    expect(isRevealablePath('/home/user/projects/archive/alpha.restorm.bak', authority())).toBe(false)
    expect(isRevealablePath('/home/user/projects/archive/other.restorm', authority())).toBe(false)
    expect(isRevealablePath('/home/user', authority())).toBe(false)
    expect(isRevealablePath('/', authority())).toBe(false)
  })

  it('refuses a relative or traversal path even when it would resolve to an allowed one', () => {
    expect(isRevealablePath('alpha.restorm', authority())).toBe(false)
    expect(isRevealablePath('/home/user/projects/archive/../archive/alpha.restorm', authority())).toBe(false)
    expect(isRevealablePath(`${RECENT_A}/..`, authority())).toBe(false)
  })

  it('refuses the empty path', () => {
    expect(isRevealablePath('', authority())).toBe(false)
  })
})
