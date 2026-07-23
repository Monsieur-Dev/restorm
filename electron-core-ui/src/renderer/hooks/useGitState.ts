import { useEffect, useState } from 'react'
import { NO_GIT_STATE } from '../../types/git'
import type { GitState } from '../../types/git'

/**
 * Subscribe to the live git state for the active folder (the folder
 * containing the currently open Restorm project file — see
 * `window.api.git.setActiveFolder`).
 *
 * Initialises to {@link NO_GIT_STATE}, reads the current snapshot once on
 * mount (`git.getState()`), then tracks every transition
 * (`git.onStateChanged`), so a consumer (status bar pastilles, title-bar
 * menu, …) re-renders the instant a commit lands, a push/pull completes,
 * or the folder-watch-triggered semi-pull finds a newer remote version.
 *
 * Requires the host app's preload to expose `window.api.git`.
 */
export function useGitState(): GitState {
  const [state, setState] = useState<GitState>(NO_GIT_STATE)
  useEffect(() => {
    const git = window.api.git
    let cancelled = false
    void git.getState().then((next) => {
      if (!cancelled) setState(next)
    })
    const unsubscribe = git.onStateChanged((next) => { setState(next) })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  return state
}
