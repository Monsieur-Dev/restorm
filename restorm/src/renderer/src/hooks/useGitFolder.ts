import { useMemo } from 'react'

/**
 * Derive the folder GitService should track from the currently open project
 * file path. Mirrors the main-process mapping in `src/main/index.ts` (the
 * `git:set-active-folder` wiring on `file:opened`): a `.restorm` project
 * tracks its CONTAINING folder.
 *
 * electron-core-ui's `GitService` exposes push/pull/etc. as folder-scoped
 * primitives (no implicit "active folder" on the renderer-facing API — see
 * `docs/Git/README.md`), so any renderer-side call needs this same folder
 * value. Kept restorm-side (not electron-core-ui) since the `.restorm`
 * extension convention is a Restorm-specific concern.
 */
export function useGitFolder(filePath: string | null): string | null {
  return useMemo(() => {
    if (!filePath) return null
    if (!filePath.endsWith('.restorm')) return null
    const lastSeparator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
    return lastSeparator === -1 ? filePath : filePath.slice(0, lastSeparator)
  }, [filePath])
}
