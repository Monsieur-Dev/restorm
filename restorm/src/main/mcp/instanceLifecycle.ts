/**
 * MCP instance-lifecycle logic — the create / terminate routes' decision core.
 *
 * These two routes are the ONLY sanctioned way for an AI to add or remove a
 * restorm instance over MCP (the launcher no longer silently auto-spawns one):
 *
 *   - CREATE: spawn a NEW instance (optionally for a given file, with an
 *     optional explicit session name), but only if no OTHER instance already
 *     has that name OR that file open — checked against the INTERNAL discovery
 *     view (all instances, including ones on which the user has CUT MCP), not
 *     the AI-facing list. Two instances on the same file is the invariant we
 *     refuse to break.
 *
 *   - TERMINATE: close the LOCAL instance with File→Quit semantics — a clean
 *     close, NEVER a pid-kill. Honours autosave; with autosave off and unsaved
 *     changes it takes a `save` param, and when that param is omitted it pops
 *     the save-confirmation modal and returns NON-BLOCKING ("awaiting user
 *     confirmation") rather than forcing the close.
 *
 * The decision logic here is pure (no Electron imports) so it is unit-testable:
 * the host injects the side-effects (spawn, save, close, show-modal) and the
 * environment snapshot (the other instances, autosave mode, dirty state, the
 * open file). The cross-instance bridge means a `terminate_instance` call
 * carrying `__session: "<peer>"` is forwarded to that peer, which then runs
 * THIS logic on ITSELF — so the route always acts locally.
 */

import { isAbsolute } from 'node:path'

/** A single instance as seen by the internal (all-instances) discovery view. */
export interface InstanceView {
  pid: number
  name: string
  projectPath: string | null
  mcpActive: boolean
}

/** Outcome of a create-instance decision. */
export type CreateDecision =
  | { ok: true; spawnFile: string | null; spawnName: string | null }
  | { ok: false; reason: string }

/** Outcome of a terminate-instance decision. */
export type TerminateAction =
  | { kind: 'closeNow' } // autosave on, or nothing dirty → just close
  | { kind: 'saveThenClose' } // not-autosave, dirty, save=true
  | { kind: 'discardThenClose' } // not-autosave, dirty, save=false
  | { kind: 'awaitUserConfirmation' } // not-autosave, dirty, save omitted → modal

/**
 * Decide whether a create-instance request is allowed. Rejects when another
 * instance already has the requested NAME, or already has the requested FILE
 * open — both checked against ALL instances (incl. MCP-cut). Self (the current
 * pid) is excluded so re-creating for the file THIS very instance has open
 * isn't falsely blocked by our own lockfile.
 */
export function decideCreateInstance(params: {
  file: string | null
  name: string | null
  selfPid: number
  instances: InstanceView[]
}): CreateDecision {
  const { file, name, selfPid, instances } = params

  if (file !== null && file !== '' && !isAbsolute(file)) {
    return { ok: false, reason: `file must be an absolute path (got "${file}").` }
  }

  const others = instances.filter((i) => i.pid !== selfPid)

  if (name !== null && name !== '') {
    const clash = others.find((i) => i.name === name)
    if (clash) {
      return {
        ok: false,
        reason:
          `An instance named "${name}" already exists (pid ${String(clash.pid)}, ` +
          `mcp ${clash.mcpActive ? 'active' : 'cut'}). Instance names must be unique; ` +
          `choose a different name or target the existing one.`
      }
    }
  }

  if (file !== null && file !== '') {
    const clash = others.find((i) => i.projectPath !== null && i.projectPath === file)
    if (clash) {
      return {
        ok: false,
        reason:
          `Another instance already has "${file}" open (pid ${String(clash.pid)}, ` +
          `name "${clash.name}", mcp ${clash.mcpActive ? 'active' : 'cut'}). ` +
          `Only one instance per file is allowed; target the existing one instead of creating a new one.`
      }
    }
  }

  return { ok: true, spawnFile: file && file !== '' ? file : null, spawnName: name && name !== '' ? name : null }
}

/**
 * Decide how to terminate the LOCAL instance. `autoSaveOn` is true when the
 * editor's autosave mode is anything other than `off`. `dirty` is the current
 * unsaved-changes state. `save` is the route's optional param.
 */
export function decideTerminateInstance(params: {
  autoSaveOn: boolean
  dirty: boolean
  save: boolean | undefined
}): TerminateAction {
  const { autoSaveOn, dirty, save } = params

  // Autosave handles persistence, or there is nothing to save → close cleanly.
  if (autoSaveOn || !dirty) return { kind: 'closeNow' }

  // Not autosave + dirty: the `save` param drives the choice.
  if (save === true) return { kind: 'saveThenClose' }
  if (save === false) return { kind: 'discardThenClose' }

  // `save` omitted + not-autosave + dirty → ask the user; do NOT force-close.
  return { kind: 'awaitUserConfirmation' }
}
