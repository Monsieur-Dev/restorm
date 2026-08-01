/**
 * Bridge MCP `update_request` IPC into the renderer's reactive request
 * proxy so any open workbench tab refreshes in place. Without this
 * hook, an MCP-driven update only flips the main-side store + the
 * `rootItems` tree wholesale; the open tab still holds the request
 * reference it captured at mount time and keeps showing pre-patch
 * values until close + reopen.
 *
 * The fix: find the request in `rootItems` by id and assign each
 * patched field via the reactive proxy (`updateReactiveProperty`),
 * which fires the standard REQUEST_UPDATED event chain — the tab,
 * status bar, search index, etc. all repaint just like a user
 * keystroke.
 */

import { useEffect } from 'react'
import { eventBus } from 'electron-core-ui/renderer'
import { findRequestById } from '../utils/treeSearch'
import { updateReactiveProperty } from '../components/RequestTabViews/requestTabViewUtils'
import type { FolderItem, KeyValue } from '../../../shared/types/collections'
import { KeyValue as KeyValueClass } from '../../../shared/models/keyValues/KeyValue'

interface RestormPatchBridge {
  onMcpRequestUpdated: (cb: (payload: { itemId: string; patch: Record<string, unknown> }) => void) => () => void
}

export interface UseMcpRequestPatchInput {
  enabled: boolean
  rootItems: FolderItem[]
  /**
   * Callback that bumps `contentVersion` on every workbench tab whose
   * underlying item id matches. The workbench tab uses `contentVersion`
   * as its render-key, so a bump forces a clean re-render that picks
   * up the latest reactive request state. Without this the open tab
   * keeps showing pre-patch values even after the proxy assignment
   * fires (the path-params table doesn't subscribe to REQUEST_UPDATED).
   * `App.tsx` exposes the existing `bumpTabContentVersionFor` helper.
   */
  bumpTabContentVersionFor: (itemId: string) => void
}

// Mirrors the main-side reify list (`src/main/mcp/tools/write.ts`) — a name
// missing here leaves plain objects on the request where the KV tables and the
// serializer expect `KeyValue` instances.
const KEYVALUE_FIELDS = new Set([
  'headers',
  'params',
  'pathParams',
  'metadata',
  'producedHeaders',
  'connectHeaders',
  'sendHeaders'
])

/**
 * `params` is a key-value array on the HTTP-shaped requests but a raw JSON
 * SOURCE STRING on JSON-RPC, so the field name alone cannot decide how to
 * apply the patch. Only an array value takes the key-value path: coercing a
 * string through the key-value reifier yielded `[]`, which wiped the editor's
 * source and then crashed the whole workbench — the code editor hands its
 * value straight to Monaco, which throws on anything that is not a string.
 */
function isKeyValuePatch(key: string, value: unknown): boolean {
  return KEYVALUE_FIELDS.has(key) && Array.isArray(value)
}

function reifyKeyValueArray(arr: unknown): KeyValue[] {
  if (!Array.isArray(arr)) return []
  return arr.map((entry: unknown): KeyValue => {
    if (entry instanceof KeyValueClass) return entry
    if (entry !== null && typeof entry === 'object') {
      return KeyValueClass.fromPlain(entry as Parameters<typeof KeyValueClass.fromPlain>[0])
    }
    return entry as KeyValue
  })
}

/**
 * Apply a KV-array patch in place. Row inputs subscribe to per-KV
 * events (user-typing path), so a wholesale array swap leaves visible
 * inputs stale.
 *
 * Strategy: when both arrays have the same length, mutate by INDEX
 * (preserves identity per row, dodges the duplicate-key collision —
 * `Set-Cookie` legitimately repeats the same key, and key-based
 * matching would drop one of them). When lengths differ, fall back to
 * a key-based merge for partial patches; duplicate keys still get
 * resolved by index of first appearance (every duplicate after the
 * first is treated as a new entry).
 */
function patchKeyValueArrayInPlace(target: KeyValue[], next: KeyValue[]): KeyValue[] {
  const FIELDS = ['key', 'value', 'description', 'enabled'] as const
  if (target.length === next.length) {
    const out: KeyValue[] = []
    for (let i = 0; i < target.length; i += 1) {
      const existing = target[i]
      const incoming = next[i]
      if (existing === undefined || incoming === undefined) continue
      const ex = existing as unknown as Record<string, unknown>
      const inc = incoming as unknown as Record<string, unknown>
      for (const field of FIELDS) {
        if (field in inc && inc[field] !== ex[field]) ex[field] = inc[field]
      }
      out.push(existing)
    }
    return out
  }
  const out: KeyValue[] = []
  const consumed = new Set<number>()
  for (const incoming of next) {
    let matched: KeyValue | undefined
    let matchedIdx = -1
    for (let i = 0; i < target.length; i += 1) {
      const candidate = target[i]
      if (candidate === undefined || consumed.has(i)) continue
      if (candidate.key === incoming.key) { matched = candidate; matchedIdx = i; break }
    }
    if (matched !== undefined) {
      consumed.add(matchedIdx)
      const ex = matched as unknown as Record<string, unknown>
      const inc = incoming as unknown as Record<string, unknown>
      for (const field of FIELDS) {
        if (field in inc && inc[field] !== ex[field]) ex[field] = inc[field]
      }
      out.push(matched)
    } else {
      out.push(incoming)
    }
  }
  return out
}

export function useMcpRequestPatch(input: UseMcpRequestPatchInput): void {
  const { enabled, rootItems, bumpTabContentVersionFor } = input

  useEffect(() => {
    if (!enabled) return
    const root = window as { restorm?: { runtime?: RestormPatchBridge } }
    const api = root.restorm?.runtime
    if (!api) return
    const off = api.onMcpRequestUpdated(({ itemId, patch }) => {
      const req = findRequestById(rootItems, itemId)
      if (!req) return
      for (const [key, value] of Object.entries(patch)) {
        if (isKeyValuePatch(key, value)) {
          // Per-KV in-place mutation — see helper for why a wholesale
          // array swap doesn't refresh the row inputs.
          const reified = reifyKeyValueArray(value)
          const reqRecord = req as unknown as Record<string, KeyValue[]>
          const merged = patchKeyValueArrayInPlace(reqRecord[key] ?? [], reified)
          updateReactiveProperty(reqRecord, key, merged)
        } else {
          // Scalar / non-KV field. Direct assignment via the reactive
          // proxy fires REQUEST_UPDATED — same path as user-typing.
          updateReactiveProperty(req as unknown as Record<string, unknown>, key, value)
        }
      }
      // Bump the workbench tab's `contentVersion` so React fully
      // re-renders the tab body (path-params table, headers table, URL
      // bar, …) — the reactive proxy events alone don't reach React's
      // reconciliation, so we mirror the `useWorkbenchUpdates` pattern
      // for a clean visual refresh.
      bumpTabContentVersionFor(itemId)
      // Also fire the `request:transport-replaced` event so the
      // HTTPRequestTabView remounts its KV tables with fresh
      // `initialRows` (the tables are uncontrolled — they cache the
      // initial array at mount and ignore subsequent prop updates).
      // Same trigger the curl-paste flow uses internally.
      eventBus.emitLocalSync('request:transport-replaced', { requestId: itemId })
    })
    return off
  }, [enabled, rootItems, bumpTabContentVersionFor])
}
