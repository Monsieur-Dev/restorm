// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { AvatarFirewallExemption, avatarHostOf, type SystemHostAllowlist } from './avatarFirewallExemption'
import { SIGNED_OUT_STATE, type AuthState } from '../../../shared/auth/authState'

/** A fake firewall allowlist that records every add/remove + holds the live set. */
function makeFakeAllowlist(): SystemHostAllowlist & { hosts: Set<string>; added: string[]; removed: string[] } {
  const hosts = new Set<string>()
  const added: string[] = []
  const removed: string[] = []
  return {
    hosts,
    added,
    removed,
    addSystemAllowedHost: (h) => { added.push(h); hosts.add(h) },
    removeSystemAllowedHost: (h) => { removed.push(h); hosts.delete(h) }
  }
}

const signedIn = (photoUrl?: string): AuthState => ({
  signedIn: true,
  user: { email: 'a@b.com', ...(photoUrl !== undefined ? { photoUrl } : {}) },
  plan: 'community',
  capabilities: []
})

describe('avatarHostOf', () => {
  it('extracts the lowercased host of the photoUrl', () => {
    expect(avatarHostOf(signedIn('https://LH3.googleusercontent.com/a/ada'))).toBe('lh3.googleusercontent.com')
  })

  it('returns null when there is no photo, no user, or a malformed URL', () => {
    expect(avatarHostOf(signedIn(undefined))).toBeNull()
    expect(avatarHostOf(SIGNED_OUT_STATE)).toBeNull()
    expect(avatarHostOf(signedIn('not a url'))).toBeNull()
  })
})

describe('AvatarFirewallExemption', () => {
  it('registers the avatar host on sign-in', () => {
    const fw = makeFakeAllowlist()
    const ex = new AvatarFirewallExemption(fw)
    ex.sync(signedIn('https://lh3.googleusercontent.com/a/ada'))
    expect(fw.hosts.has('lh3.googleusercontent.com')).toBe(true)
    expect(fw.added).toEqual(['lh3.googleusercontent.com'])
  })

  it('DROPS the host on logout — no host stays allow-listed after sign-out', () => {
    const fw = makeFakeAllowlist()
    const ex = new AvatarFirewallExemption(fw)
    ex.sync(signedIn('https://lh3.googleusercontent.com/a/ada'))
    expect(fw.hosts.size).toBe(1)

    ex.sync(SIGNED_OUT_STATE)

    expect(fw.hosts.size).toBe(0)
    expect(fw.removed).toEqual(['lh3.googleusercontent.com'])
  })

  it('swaps the exemption on a profile change (drop old host, add new)', () => {
    const fw = makeFakeAllowlist()
    const ex = new AvatarFirewallExemption(fw)
    ex.sync(signedIn('https://lh3.googleusercontent.com/a/ada'))
    ex.sync(signedIn('https://avatars.githubusercontent.com/u/42'))

    expect(fw.hosts.has('lh3.googleusercontent.com')).toBe(false)
    expect(fw.hosts.has('avatars.githubusercontent.com')).toBe(true)
    expect(fw.removed).toEqual(['lh3.googleusercontent.com'])
    expect(fw.added).toEqual(['lh3.googleusercontent.com', 'avatars.githubusercontent.com'])
  })

  it('is idempotent — re-syncing the same host neither re-adds nor removes', () => {
    const fw = makeFakeAllowlist()
    const ex = new AvatarFirewallExemption(fw)
    const state = signedIn('https://lh3.googleusercontent.com/a/ada')
    ex.sync(state)
    ex.sync(state)
    expect(fw.added).toEqual(['lh3.googleusercontent.com'])
    expect(fw.removed).toEqual([])
  })

  it('registers nothing for a signed-in user without a photo (initials fallback)', () => {
    const fw = makeFakeAllowlist()
    const ex = new AvatarFirewallExemption(fw)
    ex.sync(signedIn(undefined))
    expect(fw.added).toEqual([])
    expect(fw.hosts.size).toBe(0)
  })

  it('clear() drops any active exemption and is idempotent', () => {
    const fw = makeFakeAllowlist()
    const ex = new AvatarFirewallExemption(fw)
    ex.sync(signedIn('https://lh3.googleusercontent.com/a/ada'))
    ex.clear()
    expect(fw.hosts.size).toBe(0)
    expect(fw.removed).toEqual(['lh3.googleusercontent.com'])
    ex.clear() // no-op the second time
    expect(fw.removed).toEqual(['lh3.googleusercontent.com'])
  })
})
