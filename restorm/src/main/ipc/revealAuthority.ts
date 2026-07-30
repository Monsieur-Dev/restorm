/**
 * Authority check for the reveal-in-folder channel.
 *
 * The renderer names the path it wants revealed, but it is never trusted:
 * the main process decides, from state it owns, whether that path may be
 * handed to the OS shell. Exactly two things qualify — the project that is
 * currently open, and a file the main process already tracks in its recent
 * files list (the welcome screen reveals one of its entries while no
 * project is open at all). Anything else is refused, so the channel cannot
 * be repurposed into "reveal any path on disk".
 *
 * Lives apart from the handler so the decision is testable on its own,
 * without standing up Electron or the file service.
 */

/** The main-process state a reveal decision is made against. */
export interface RevealAuthority {
  /** Path of the currently open project, or `null` when none is open. */
  openProjectPath: string | null
  /** Paths main tracks as recent files (favorites are a subset of these). */
  recentPaths: readonly string[]
}

/**
 * Whether `path` may be revealed. Membership is **exact string equality**,
 * never a prefix or substring test — a containment-style check would let a
 * caller walk out of the allowed set by naming a sibling or a parent.
 */
export function isRevealablePath(path: string, authority: RevealAuthority): boolean {
  if (authority.openProjectPath !== null && path === authority.openProjectPath) return true
  return authority.recentPaths.some((tracked) => tracked === path)
}
