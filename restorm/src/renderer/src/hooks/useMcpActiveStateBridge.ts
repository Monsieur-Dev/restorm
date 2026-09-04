/**
 * Push the renderer's "active workbench tab" + per-env-folder selection
 * to the main process so the MCP `get_current_tab` / `get_active_env`
 * tools can read it without a renderer round-trip on every call.
 *
 * The renderer owns the truth (React state); main mirrors a small
 * snapshot. This is a fire-and-forget IPC — no acknowledgement, no
 * retry. If main misses an event it resyncs on the next change or via
 * the bootstrap push fired on mount.
 *
 * Disabled outside MCP mode: when `mcpEnabled` is false the hook
 * silently no-ops so we don't pay any IPC cost in the common case.
 */

import { useEffect, useRef } from 'react'

type ActiveKind = 'request' | 'folder' | 'env-folder' | 'scenario' | 'design' | null

interface RestormRuntimeBridge {
  pushMcpActiveTab: (payload: { tabId: string | null; itemId: string | null; kind: ActiveKind }) => void
  pushMcpActiveEnv: (payload: { envFolderId: string; envId: string | null }) => void
  pushMcpActiveStateBootstrap: (payload: {
    tab: { tabId: string | null; itemId: string | null; kind: ActiveKind }
    envByFolder: Record<string, string | null>
  }) => void
}

export interface McpActiveStateInput {
  enabled: boolean
  tabId: string | null
  itemId: string | null
  kind: ActiveKind
  envByFolder: Record<string, string | null>
}

export function useMcpActiveStateBridge(input: McpActiveStateInput): void {
  const { enabled, tabId, itemId, kind, envByFolder } = input
  const lastTabRef = useRef<string>('')
  const lastEnvByFolderRef = useRef<string>('')
  const bootstrapSentRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    const root = window as { restorm?: { runtime?: RestormRuntimeBridge } }
    const api = root.restorm?.runtime
    if (!api) return
    if (!bootstrapSentRef.current) {
      api.pushMcpActiveStateBootstrap({
        tab: { tabId, itemId, kind },
        envByFolder
      })
      bootstrapSentRef.current = true
      lastTabRef.current = JSON.stringify({ tabId, itemId, kind })
      lastEnvByFolderRef.current = JSON.stringify(envByFolder)
      return
    }
    const tabKey = JSON.stringify({ tabId, itemId, kind })
    if (tabKey !== lastTabRef.current) {
      api.pushMcpActiveTab({ tabId, itemId, kind })
      lastTabRef.current = tabKey
    }
    const envKey = JSON.stringify(envByFolder)
    if (envKey !== lastEnvByFolderRef.current) {
      // Diff against the previous snapshot; only push the changed
      // entries. Keeps IPC traffic minimal even if `envByFolder` is
      // recreated on every render with the same content.
      const prev: Record<string, string | null> = lastEnvByFolderRef.current
        ? (JSON.parse(lastEnvByFolderRef.current) as Record<string, string | null>)
        : {}
      for (const [k, v] of Object.entries(envByFolder)) {
        if (prev[k] !== v) api.pushMcpActiveEnv({ envFolderId: k, envId: v })
      }
      for (const k of Object.keys(prev)) {
        if (!(k in envByFolder)) api.pushMcpActiveEnv({ envFolderId: k, envId: null })
      }
      lastEnvByFolderRef.current = envKey
    }
  }, [enabled, tabId, itemId, kind, envByFolder])
}
