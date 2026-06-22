/**
 * MCP instance-lifecycle tools — `create_instance` and `terminate_instance`.
 *
 * These are the explicit, documented routes that replace the launcher's old
 * silent auto-spawn. The pure decision logic lives in `../instanceLifecycle`;
 * this module wires it to the running app via a host adapter the main process
 * injects (so the Electron-specific side-effects — spawn, save, close, modal —
 * stay out of the testable core and out of this tool file's import graph).
 */

import { z } from 'zod'
import { McpService, getFileService, isFileServiceInitialized, getSettingsService, isSettingsServiceInitialized, readAllInstancesIncludingCut } from 'electron-core-ui/main'
import { decideCreateInstance, decideTerminateInstance, type InstanceView } from '../instanceLifecycle'

/** Host side-effects the main process supplies; kept behind an interface so the
 * tools never import Electron / the app's window plumbing directly. */
export interface InstanceLifecycleHost {
  /** Absolute path of the shared MCP discovery dir (the internal all-instances view). */
  readonly discoveryDir: string
  /** This instance's pid (excluded from the uniqueness check). */
  readonly selfPid: number
  /** Spawn a NEW detached restorm instance for `file` (or none) with `name`
   * (or the auto-default). Returns once the spawn was launched (not awaited to
   * readiness — discovery is async). */
  spawnInstance(file: string | null, name: string | null): void
  /** Editor autosave is ON (mode !== 'off'). */
  isAutoSaveOn(): boolean
  /** Save the open project, then close this instance (File→Quit). */
  saveThenClose(): void
  /** Discard unsaved changes, then close this instance. */
  discardThenClose(): void
  /** Close this instance (nothing dirty / autosave handles it). */
  closeNow(): void
  /** Pop the native save-confirmation modal (File→Quit's dialog). Non-blocking. */
  showSaveModal(): void
}

function jsonReply(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** Read the internal all-instances view (incl. MCP-cut) for the uniqueness check. */
function readInstances(dir: string): InstanceView[] {
  return readAllInstancesIncludingCut(dir).map((i) => ({
    pid: i.pid,
    name: i.name,
    projectPath: i.projectPath,
    mcpActive: i.mcpActive
  }))
}

export function registerInstanceLifecycleTools(mcp: McpService, host: InstanceLifecycleHost): void {
  mcp.registerTool(
    'create_instance',
    {
      titleKey: 'mcpToolTitles.createInstance',
      title: 'Create a new MCP instance',
      description:
        'Explicitly launch a NEW instance of this app that accepts MCP, optionally opening a ' +
        'specific project file and/or with an explicit session name. The launcher NEVER ' +
        'auto-starts an instance, so this is how you get one when `list-instances` is empty or ' +
        'when you want a fresh instance for a file. Creation is REFUSED if another instance ' +
        '(MCP-active OR with MCP cut) already has the requested `name`, or already has the ' +
        'requested `file` open — only one instance per file is allowed. On success the new ' +
        'instance appears in `list-instances` shortly after; target it with `__session`.',
      inputSchema: {
        file: z.string().min(1).optional().describe(
          'Absolute path to a .restorm project file to open in the new instance. Omit for an empty instance. Must be absolute.'
        ),
        name: z.string().min(1).optional().describe(
          'Explicit session name for the new instance (used to target it via `__session`). Omit to auto-derive one from the file / a pid id (note: an auto name is NOT stable across launches — prefer an explicit name or rely on per-file uniqueness).'
        )
      } as Record<string, unknown>
    },
    (args: Record<string, unknown>) => {
      const file = typeof args['file'] === 'string' ? args['file'] : null
      const name = typeof args['name'] === 'string' ? args['name'] : null

      const decision = decideCreateInstance({
        file,
        name,
        selfPid: host.selfPid,
        instances: readInstances(host.discoveryDir)
      })
      if (!decision.ok) return errorReply(decision.reason)

      host.spawnInstance(decision.spawnFile, decision.spawnName)
      return jsonReply({
        created: true,
        file: decision.spawnFile,
        name: decision.spawnName,
        note: 'Instance launching. It will appear in list-instances once its MCP endpoint is up.'
      })
    }
  )

  mcp.registerTool(
    'terminate_instance',
    {
      titleKey: 'mcpToolTitles.terminateInstance',
      title: 'Terminate an MCP instance',
      description:
        'Cleanly close an instance — the same effect as File→Quit, NEVER a forced pid-kill. ' +
        'Targets the instance you address (pass `__session: "<name>"` to terminate a specific ' +
        'one; omit to terminate the one you are connected to). If the editor has autosave on, ' +
        'or nothing is unsaved, it closes immediately. If autosave is off AND there are unsaved ' +
        'changes, pass `save: true` to save-then-close or `save: false` to discard-then-close. ' +
        'If you omit `save` in that case, the app shows the user a save-confirmation modal and ' +
        'this route returns NON-BLOCKING ("awaiting user confirmation") — it does not force the ' +
        'close; the user decides.',
      inputSchema: {
        save: z.boolean().optional().describe(
          'Whether to save before closing, when autosave is off and there are unsaved changes. true = save then close; false = discard then close; omitted = show the user the save-confirmation modal (non-blocking).'
        )
      } as Record<string, unknown>
    },
    (args: Record<string, unknown>) => {
      const save = typeof args['save'] === 'boolean' ? args['save'] : undefined
      const dirty = isFileServiceInitialized() ? getFileService().isDirty() : false
      const action = decideTerminateInstance({ autoSaveOn: host.isAutoSaveOn(), dirty, save })

      switch (action.kind) {
        case 'closeNow':
          host.closeNow()
          return jsonReply({ terminating: true, mode: 'closeNow' })
        case 'saveThenClose':
          host.saveThenClose()
          return jsonReply({ terminating: true, mode: 'saveThenClose' })
        case 'discardThenClose':
          host.discardThenClose()
          return jsonReply({ terminating: true, mode: 'discardThenClose' })
        case 'awaitUserConfirmation':
          host.showSaveModal()
          return jsonReply({
            terminating: false,
            mode: 'awaitUserConfirmation',
            note: 'Unsaved changes with autosave off and no `save` param given — the user has been shown a save-confirmation modal and must confirm. The instance was NOT closed.'
          })
      }
    }
  )
}

/** Read whether autosave is ON (mode !== 'off') from settings. Exported so the
 * host adapter in the main process reuses the exact key + default. */
export function readAutoSaveOn(): boolean {
  if (!isSettingsServiceInitialized()) return false
  const mode = getSettingsService().get('files:autoSave')
  return typeof mode === 'string' && mode !== 'off'
}
