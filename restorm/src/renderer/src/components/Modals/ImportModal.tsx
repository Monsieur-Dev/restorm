/**
 * ImportModal - Modal for importing requests from various sources
 */

import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  Modal,
  Button,
  InputBox,
  KeyValueTable,
  Tabs,
  Wordmark,
  getContrastColor,
  type Tab,
  type KeyValueTableHandle,
  type KeyValueTableRow
} from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import type { FolderItem, EnvironmentFolder, Folder } from '../../../../shared/types/collections'
import { isEnvironmentFolder, isRequest } from '../../../../shared/types/collections'
import type { ApiDocumentation } from '../../../../shared/types/apiDocumentation'
import type { AuthenticationRequest } from '../../../../shared/models'
import { logger } from 'electron-core-ui/renderer'
import { AuthenticationSetupModal } from './AuthenticationSetupModal'
import { DocumentationHost } from '../documentation/DocumentationHost'
import { ImportFormatShowcase } from './ImportFormatShowcase'
import { GrpcReflectionImportModal } from './GrpcReflectionImportModal'
import { ImportSelectionTree } from './ImportSelectionTree'
import { allLeafKeys } from './importSelectionHelpers'
import { filterImportTreeBySelection } from '../../../../shared/utils/importNaturalKey'
import type { ImportMeta } from '../../hooks/useImport'
import './ImportModal.css'

/**
 * Optional payload that flips the modal into "Refresh from source"
 * mode. When set, the modal:
 *
 * - Pre-fills the source URL + the attached auth route from the
 *   already-imported env folder. Both fields are display-only —
 *   they're sourced from the env folder's stored apiUpdate config
 *   and aren't editable in this flow.
 * - Runs the regular `import.preview` against the stored sourceUrl
 *   with the env folder's headers attached, then renders the tree
 *   alongside the routes already in the folder. The locked-keys set
 *   stays empty: a refresh proposes the full spec, the wizard's
 *   tri-state checkboxes let the user trim it before confirming.
 * - Replaces the "Import" button with "Apply update" and routes the
 *   confirm action to `apiUpdate.apply` instead of the fresh-import
 *   handler. The callback receives the resulting payload so the host
 *   can splice the new requests onto its own copy of the env folder.
 */
export interface RefreshContext {
  sourceUrl: string
  authenticationRequest?: AuthenticationRequest
  /**
   * Manual headers persisted on the env folder's
   * `apiUpdate.sourceHeaders`. Pre-fills the modal's KV table so
   * the user can see / edit them before the refresh fires. Order
   * is preserved from the on-disk map.
   */
  sourceHeaders?: Record<string, string>
  targetFolderId: string
  /**
   * Natural keys of every request already present in the target
   * env folder. Computed by the host from the existing folder
   * before opening the modal. The bootstrap intersects this set
   * with the preview's leaf keys to drive `lockedKeys` — already-
   * imported routes land pre-checked + locked, new routes arrive
   * unchecked so the user opts into them explicitly.
   */
  existingLeafKeys?: ReadonlySet<string>
  onApplied: (updatedFolder: unknown) => void
}

export interface ImportModalProps {
  isOpen: boolean
  onClose: () => void
  /**
   * `meta` is set for a fresh (non-refresh) import when the preview
   * succeeded — it lets the host re-run the imported format's
   * post-import seed step (see `useImport.ts`'s `ImportMeta`) once the
   * tree lands with its final ids. Absent for imports with no tracked
   * format (e.g. the gRPC reflection sub-modal).
   */
  onImport: (items: FolderItem[], meta?: ImportMeta) => void
  refreshContext?: RefreshContext
}

/**
 * Merge the auth-route resolved headers (left) with the manual KV
 * table headers (right). Manual values overlay auth values so the
 * user can override a specific header for testing without removing
 * the auth attach. Rows with empty keys or disabled toggles are
 * skipped. Returns `null` when nothing meaningful is configured so
 * the caller can omit `extraHeaders` from the request init
 * altogether.
 */
function composeExtraHeaders(
  authHeaders: Record<string, string> | null,
  manualRows: { key: string; value: string; enabled: boolean }[]
): Record<string, string> | null {
  const out: Record<string, string> = {}
  if (authHeaders !== null) {
    for (const [k, v] of Object.entries(authHeaders)) out[k] = v
  }
  for (const row of manualRows) {
    if (!row.enabled) continue
    const k = row.key.trim()
    if (k.length === 0) continue
    out[k] = row.value
  }
  return Object.keys(out).length > 0 ? out : null
}

export function ImportModal({
  isOpen,
  onClose,
  onImport,
  refreshContext
}: ImportModalProps): React.JSX.Element {
  const { t } = useTranslation()

  // Drop-zone border contrast: read the modal's background variable
  // (`--editor-background`, set by the active theme) and pick the
  // higher-contrast of black / white so the dashed outline reads on
  // every theme without hardcoding a colour. Recomputed when the
  // modal opens — themes can flip between mounts.
  const dropZoneRef = useRef<HTMLDivElement | null>(null)
  const [dropZoneColor, setDropZoneColor] = useState<string>('#ffffff')

  // Modal-wide drag tracking. Listens on the whole modal body (not
  // just the visible drop-zone rectangle) so any drag entering the
  // dialog hides the format showcase and tints the drop-zone fill.
  // The dragleave handler filters out child-transition events via
  // `relatedTarget` (see below), and a window-level safety net
  // resets state on `drop` / `dragend` / `mouseleave` so we never
  // stay stuck after a cancelled or window-exit drag.
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [previewItems, setPreviewItems] = useState<FolderItem[]>([])
  // SHA-256 of the raw response body the importer parsed, returned by
  // `import.preview`. Stamped onto the env folder's `apiUpdate` at
  // commit-import time so a later Refresh can confirm "no change
  // since this import" by comparing checksums.
  const [previewChecksum, setPreviewChecksum] = useState<string | undefined>(undefined)
  // Format `import.preview` detected + the extraHeaders composed for that
  // fetch, threaded to `onImport` at commit time so `useImport` can re-run
  // the format's `postImportSeed` step (see `ImportManager.runPostImportSeed`)
  // with the same source. Unset for the refresh-from-source bootstrap below
  // (that path never calls `onImport`, it goes through `apiUpdate.apply`).
  const [previewFormat, setPreviewFormat] = useState<string | undefined>(undefined)
  const [previewExtraHeaders, setPreviewExtraHeaders] = useState<Record<string, string> | undefined>(undefined)
  /**
   * Set of leaf natural keys the user wants to import. Initialised
   * to the full leaf set whenever a fresh preview lands so the
   * default behaviour matches the legacy "import everything" UX,
   * then narrowed as the user un-checks rows in the selection tree.
   */
  const [selection, setSelection] = useState<Set<string>>(() => new Set())
  const [searchFilter, setSearchFilter] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [attachedAuth, setAttachedAuth] = useState<AuthenticationRequest | null>(null)
  // Resolved auth headers live in a ref rather than state — the only
  // consumer is the debounced preview closure, and we need the value
  // to be readable synchronously after `handleAuthAttach` fires
  // (React state updates batch, so a closure would see `null`).
  const attachedAuthHeadersRef = useRef<Record<string, string> | null>(null)
  const [showAuthSetupModal, setShowAuthSetupModal] = useState(false)
  // gRPC reflection doesn't fit the paste/file/URL auto-detect flow the
  // source input drives (its "source" is a live host:port connection, not
  // text to sniff) — it gets its own dedicated form, launched from the
  // showcase bubble's action button (see `handleShowcaseAction` below).
  const [showGrpcReflectionModal, setShowGrpcReflectionModal] = useState(false)
  /**
   * One-shot manual headers attached to the spec fetch. Used when
   * the user just wants to paste an `Authorization: Bearer …` token
   * to import a gated swagger, without going through the full
   * `AuthenticationRequest` flow. Persist on the imported env
   * folder's `apiUpdate.sourceHeaders` so subsequent
   * "Refresh from source" / `apiUpdate.apply` runs reuse them
   * automatically.
   *
   * Stored as the same shape the ECUI `KeyValueTable` produces so
   * the component round-trips without lossy normalisation.
   */
  const [manualHeaders, setManualHeaders] = useState<{ id: string; key: string; value: string; enabled: boolean }[]>([])
  const manualHeadersRef = useRef<{ id: string; key: string; value: string; enabled: boolean }[]>([])
  manualHeadersRef.current = manualHeaders
  const [customHeadersOpen, setCustomHeadersOpen] = useState(false)
  const customHeadersTableRef = useRef<KeyValueTableHandle | null>(null)
  /**
   * Set of leaf natural keys whose checkbox is forced-on + disabled
   * because their operation already exists in the target folder.
   * Populated by the refresh-from-source bootstrap from the
   * intersection of `refreshContext.existingLeafKeys` with the
   * fetched preview tree's leaves. Fresh imports leave this empty.
   */
  const [lockedKeys, setLockedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cross-section fade machine. When the user enters a valid source,
  // `previewItems` populates → we want the rotating-format-showcase to
  // fade out and the route-preview tree to fade in. When the user
  // overwrites the input with something that yields no preview, we go
  // back: tree fades out, showcase fades back in. The state machine
  // here mounts only one section at a time so they never both compete
  // for the same layout slot.
  //
  //   `displayedSection` → which section is currently in the DOM
  //   `transitionPhase`  → 'leaving' (fade-out) | 'entering' (fade-in) | null (idle)
  //
  // 300 ms feels right for both halves; total swap time is 600 ms.
  type Section = 'showcase' | 'preview'
  type Phase = 'leaving' | 'entering' | null
  const FADE_MS = 300
  const targetSection: Section = (refreshContext !== undefined || previewItems.length > 0) ? 'preview' : 'showcase'
  const [displayedSection, setDisplayedSection] = useState<Section>(targetSection)
  const [transitionPhase, setTransitionPhase] = useState<Phase>(null)
  // Bumping this key when we re-enter the showcase forces
  // `<ImportFormatShowcase>` to remount with a fresh rotation engine
  // (the user explicitly asked for the bubble cycle to "restart" on
  // every return to the showcase, not to resume mid-cycle).
  const [showcaseMountSeq, setShowcaseMountSeq] = useState(0)
  const prevDisplayedRef = useRef<Section>(displayedSection)

  useLayoutEffect(() => {
    if (!isOpen) return
    const el = dropZoneRef.current
    if (el === null) return
    const bg = getComputedStyle(el).getPropertyValue('--editor-background').trim()
    if (bg.length === 0) return
    setDropZoneColor(getContrastColor(bg))
  }, [isOpen])

  useEffect(() => {
    if (targetSection === displayedSection) return
    setTransitionPhase('leaving')
    const leaveTimer = setTimeout(() => {
      setDisplayedSection(targetSection)
      setTransitionPhase('entering')
    }, FADE_MS)
    return () => { clearTimeout(leaveTimer) }
  }, [targetSection, displayedSection])

  useEffect(() => {
    if (transitionPhase !== 'entering') return
    const enterTimer = setTimeout(() => { setTransitionPhase(null) }, FADE_MS)
    return () => { clearTimeout(enterTimer) }
  }, [transitionPhase])

  useEffect(() => {
    if (prevDisplayedRef.current === 'preview' && displayedSection === 'showcase') {
      setShowcaseMountSeq((seq) => seq + 1)
    }
    prevDisplayedRef.current = displayedSection
  }, [displayedSection])

  // Handle input change with debounce
  const handleInputChange = useCallback((value: string) => {
    setInput(value)
    setError(null)

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // If input is empty, clear preview immediately
    if (!value.trim()) {
      logger.warn('[ImportModal] Clearing preview items - input is empty', { value })
      setPreviewItems([])
      setPreviewFormat(undefined)
      setPreviewExtraHeaders(undefined)
      setSelection(new Set())
      setSearchFilter('')
      setIsLoading(false)
      debounceTimerRef.current = null
      return
    }

    // Set loading state
    setIsLoading(true)

    // Debounce the preview
    debounceTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          // Compose `extraHeaders` from the two surfaces the user
          // can wire into a gated import: the auth-route attach
          // (whose resolved headers live in
          // `attachedAuthHeadersRef`) and the manual headers KV
          // table just below. Manual values overlay auth values so
          // a user can override a specific header for testing
          // without detaching the route. Refs (rather than state)
          // because the debounced closure can fire before the
          // setState has propagated.
          const composed = composeExtraHeaders(
            attachedAuthHeadersRef.current,
            manualHeadersRef.current
          )
          const previewOptions = composed !== null
            ? { extraHeaders: composed }
            : undefined
          const result = await window.restorm?.import.preview(value.trim(), previewOptions)

          if (result?.success) {
            const ck = (result as { payloadChecksum?: string }).payloadChecksum
            logger.info('[import.preview] captured checksum', { hasChecksum: ck !== undefined, checksum: ck })
            setPreviewItems(result.items as FolderItem[])
            setPreviewChecksum(ck)
            setPreviewFormat(result.format)
            setPreviewExtraHeaders(composed ?? undefined)
            setError(null)
          } else {
            setPreviewItems([])
            setPreviewChecksum(undefined)
            setPreviewFormat(undefined)
            setPreviewExtraHeaders(undefined)
            setError(result?.error ?? t('import.error.unknown'))
          }
        } catch (err) {
          setPreviewItems([])
          setPreviewChecksum(undefined)
          setPreviewFormat(undefined)
          setPreviewExtraHeaders(undefined)
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setIsLoading(false)
        }
      })()
    }, 200)
  }, [t])

  // Re-run the preview whenever the manual headers change (and the
  // user has already typed a URL). The debounce inside
  // `handleInputChange` collapses keystroke-bursts on the KV table
  // the same way it collapses URL typing, so the preview only
  // re-fires once the row sits still for 200 ms.
  //
  // Skip this entirely when the modal is in refresh-from-source
  // mode — that path runs its own `import.preview` against the
  // stored URL on open, with the env folder's persisted headers
  // already attached. The URL-input handler would otherwise stomp
  // on the tree that refresh bootstrap produced.
  useEffect(() => {
    if (refreshContext !== undefined) return
    if (input.trim().length === 0) return
    handleInputChange(input)
  }, [manualHeaders, input, handleInputChange, refreshContext])

  // Modal-wide drag tracking. Bound on the `.import-modal` div so any
  // drag entering the dialog (regardless of which inner element the
  // cursor lands on first) hides the showcase + tints the drop-zone
  // fill. State is a single boolean: `dragenter` flips it on,
  // `dragleave` filters out child-transition events via
  // `relatedTarget` before flipping it off, and a window-level
  // safety net (`drop` / `dragend` / `mouseleave`) catches cancelled
  // or window-exit drags so we never stay stuck in drop-mode.
  const handleModalDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    // Skip drags carrying nothing useful — assumes nothing inside
    // the modal is `draggable`, which is true today; revisit this
    // gate if any child becomes a drag source (e.g. reorderable
    // tree node), since their `dragstart` would briefly produce an
    // empty-types dragenter and get filtered.
    if (event.dataTransfer.types.length === 0) return
    event.preventDefault()
    setIsDraggingOver(true)
  }, [])

  const handleModalDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    // dragleave fires every time the cursor crosses into a child
    // element too — `relatedTarget` is the element we're moving into
    // (or null when the cursor leaves the window entirely). If it's
    // still inside the modal, we haven't truly left; ignore.
    const related = event.relatedTarget as Node | null
    if (related !== null && event.currentTarget.contains(related)) return
    setIsDraggingOver(false)
  }, [])

  const handleModalDragOver = useCallback((event: React.DragEvent) => {
    // Required to keep the dropzone "valid" so the OS shows the
    // copy / move cursor and dragenter fires on the next child the
    // user crosses. Without preventDefault the spec disables the
    // drop target and we lose downstream events.
    event.preventDefault()
  }, [])

  const handleModalDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDraggingOver(false)

    // Pull the most useful payload the OS gave us, in order of
    // specificity:
    //   1. Files — Electron exposes the full absolute path on
    //      `file.path`, which is exactly what the import pipeline
    //      wants for local-file imports.
    //   2. URI list — Firefox / Chrome use this when you drag a link
    //      from another tab; first line is the URL.
    //   3. Plain text — fallback for selections (cURL command, raw
    //      JSON pasted from a sibling tool).
    const dt = event.dataTransfer

    if (dt.files.length > 0) {
      const file = dt.files[0]
      if (file) {
        // Electron 32+ no longer populates `File.path`; the
        // supported replacement is `webUtils.getPathForFile()`,
        // exposed here via the preload bridge as
        // `restorm.file.getPathForFile`. It returns the absolute
        // path for a real on-disk file or an empty string for a
        // Blob-backed File (clipboard image, etc.) — the latter
        // would only happen for non-file drags, but we still
        // fall back on `file.name` so the input never goes empty.
        const path = window.restorm?.file.getPathForFile(file) ?? ''
        handleInputChange(path.length > 0 ? path : file.name)
        return
      }
    }
    const uri = dt.getData('text/uri-list').split('\n').find((line) => line.trim().length > 0 && !line.startsWith('#'))
    if (uri) {
      handleInputChange(uri.trim())
      return
    }
    const text = dt.getData('text/plain').trim()
    if (text) {
      handleInputChange(text)
    }
  }, [handleInputChange])

  // Safety net: window-level listeners that fire when a drag actually
  // ends, regardless of whether the drop happened inside the modal,
  // outside the window, or got cancelled with Escape. Without this
  // we sometimes stay stuck in `isDraggingOver === true` because the
  // synthetic React `dragleave` on `.import-modal` doesn't always
  // fire when the cursor exits via a fast diagonal that crosses an
  // overlay / iframe edge mid-flight.
  useEffect(() => {
    if (!isDraggingOver) return
    const reset = (): void => { setIsDraggingOver(false) }
    window.addEventListener('drop', reset)
    window.addEventListener('dragend', reset)
    window.addEventListener('mouseleave', reset)
    return () => {
      window.removeEventListener('drop', reset)
      window.removeEventListener('dragend', reset)
      window.removeEventListener('mouseleave', reset)
    }
  }, [isDraggingOver])

  // Handle import click
  const handleImportClick = useCallback(() => {
    if (previewItems.length === 0) return
    if (selection.size === 0) return

    // Refresh-from-source confirm path: route through the apiUpdate
    // apply IPC instead of the fresh-import handler. Selection is
    // already in ImportSelectionTree key shape (`request:http:METHOD
    // …`, `request:graphql:…`, …); main translates back to pipeline
    // naturalKeys before filtering the spec. We hand both `include`
    // and `skip` so a previously-skipped route stays skipped on the
    // next refresh unless the user explicitly opts it in here.
    if (refreshContext) {
      const allKeys = allLeafKeys(previewItems)
      const include = Array.from(selection).sort()
      const skip = Array.from(allKeys).filter((k) => !selection.has(k)).sort()
      // Manual headers edited inside the refresh modal need to land
      // on `apiUpdate.sourceHeaders` BEFORE the refresh fires so the
      // next scheduled refresh sees them too. The apply IPC re-fetches
      // the spec using the (now-updated) sourceHeaders.
      const refreshHeadersRecord: Record<string, string> = {}
      for (const row of manualHeaders) {
        if (!row.enabled) continue
        const k = row.key.trim()
        if (k.length === 0) continue
        refreshHeadersRecord[k] = row.value
      }
      void (async () => {
        try {
          const api = window.restorm?.apiUpdate
          // Persist the latest header edits first so the apply
          // sees them; without this the refresh would still use
          // whatever was on disk when the modal opened.
          await api?.setSettings(refreshContext.targetFolderId, { sourceHeaders: refreshHeadersRecord })
          const result = await api?.apply(refreshContext.targetFolderId, { include, skip })
          refreshContext.onApplied(result?.updatedFolder)
        } catch (err) {
          logger.error('[ImportModal] apiUpdate.apply failed', { error: err instanceof Error ? err.message : String(err) })
        } finally {
          onClose()
        }
      })()
      return
    }

    // Apply the user's selective-import choice before any further
    // transformation: leaves not in `selection` are dropped, and
    // folders that lose all of their selected descendants are
    // pruned. The auth-attach pass and the upstream import pipeline
    // only see the kept subset, so skipped items never materialise.
    const selectedItems = filterImportTreeBySelection(previewItems, selection)

    // If the user attached an auth request, wire every imported
    // request to reference it and nest the auth route itself as the
    // FIRST child of the top-level imported folder (usually the
    // env-folder the importer produced). The auth route belongs to
    // the imported collection, not to whatever sits next to it at
    // the true root — folder-mode save then lays it out as
    // `Microsoft.Dynamics.CRM/0001 - Authentication route.yaml`
    // instead of writing a stray auth folder alongside the env
    // folder.
    let finalItems: FolderItem[] = selectedItems
    if (attachedAuth) {
      const authId = attachedAuth.id
      const attach = (items: FolderItem[]): FolderItem[] => items.map((item) => {
        if ('items' in item) {
          return { ...item, items: attach(item.items) }
        }
        if (isRequest(item)) {
          return Object.assign(Object.create(Object.getPrototypeOf(item) as object), item, {
            authenticationRequestId: authId
          }) as FolderItem
        }
        return item
      })
      const attachedTree = attach(selectedItems)
      const firstFolderIdx = attachedTree.findIndex((item) => 'items' in item)
      if (firstFolderIdx >= 0) {
        const firstFolder = attachedTree[firstFolderIdx] as Folder
        finalItems = [
          ...attachedTree.slice(0, firstFolderIdx),
          { ...firstFolder, items: [attachedAuth as unknown as FolderItem, ...firstFolder.items] } as FolderItem,
          ...attachedTree.slice(firstFolderIdx + 1)
        ]
      } else {
        // Shouldn't happen in practice — every importer produces at
        // least one top-level folder — but fall back to prepending
        // at the true root rather than dropping the attached auth.
        finalItems = [attachedAuth as unknown as FolderItem, ...attachedTree]
      }
    }

    // Stamp the apiUpdate config on every top-level env folder so a
    // future refresh has every field the orchestrator needs: the URL
    // we just fetched from, the static defaults from the migration,
    // and the attached auth-route id when the user supplied one.
    // Tying sourceUrl in here — instead of leaving it to the legacy
    // migration step — means the "Refresh from source" entry shows
    // up immediately after the import, without waiting for the next
    // project reload.
    const sourceUrlAtImport = input.trim()
    const isUrlImport = sourceUrlAtImport.startsWith('http://') || sourceUrlAtImport.startsWith('https://')
    // Manual headers persisted on the env folder so subsequent
    // "Refresh from source" runs reuse them automatically without
    // the user retyping the token. Only enabled rows with a
    // non-empty key are saved; rows the user toggled off are
    // dropped to avoid surprising the next refresh.
    const manualHeadersAsRecord: Record<string, string> = {}
    for (const row of manualHeaders) {
      if (!row.enabled) continue
      const k = row.key.trim()
      if (k.length === 0) continue
      manualHeadersAsRecord[k] = row.value
    }
    const hasManualHeaders = Object.keys(manualHeadersAsRecord).length > 0
    const stampApiUpdate = (items: FolderItem[]): FolderItem[] => items.map((item) => {
      if (!isEnvironmentFolder(item)) return item
      const stamped = { ...item } as EnvironmentFolder
      if (isUrlImport) {
        const existing = (stamped as unknown as { apiUpdate?: Record<string, unknown> }).apiUpdate ?? {}
        ;(stamped as unknown as { apiUpdate?: Record<string, unknown> }).apiUpdate = {
          sourceUrl: sourceUrlAtImport,
          lastImportedAt: Date.now(),
          ...existing,
          // `payloadChecksum` MUST match the value `refresh-fetch`
          // recomputes on the next user-triggered Refresh — both
          // hashes are SHA-256 of the raw response body, computed
          // identically on the main side. Without this stamp, a
          // freshly imported folder would always report "update
          // available" on the first Refresh (stored checksum
          // undefined vs. a non-undefined just-fetched one).
          ...(previewChecksum !== undefined ? { payloadChecksum: previewChecksum } : {}),
          ...(attachedAuth ? { authenticationRequestId: attachedAuth.id } : {}),
          ...(hasManualHeaders ? { sourceHeaders: manualHeadersAsRecord } : {})
        }
      } else if (attachedAuth || hasManualHeaders) {
        // File imports don't get a sourceUrl, but if the user
        // attached an auth route OR pasted manual headers we still
        // capture them for any manual URL the user types into the
        // env-folder home.
        const apiUpdate = (stamped as unknown as { apiUpdate?: Record<string, unknown> }).apiUpdate ?? {}
        ;(stamped as unknown as { apiUpdate?: Record<string, unknown> }).apiUpdate = {
          ...apiUpdate,
          ...(attachedAuth ? { authenticationRequestId: attachedAuth.id } : {}),
          ...(hasManualHeaders ? { sourceHeaders: manualHeadersAsRecord } : {})
        }
      }
      return stamped
    })
    finalItems = stampApiUpdate(finalItems)
    logger.info('[import.commit] stamp', {
      isUrlImport,
      sourceUrl: sourceUrlAtImport,
      hasPreviewChecksum: previewChecksum !== undefined,
      previewChecksum
    })

    // Imports always land at the project root — the destination
    // picker (and the per-import "new folder" creation that went with
    // it) is gone until the import-screen redesign defines a path
    // that's actually wired through the persistence layer.
    // `previewFormat` is unset only when the preview never succeeded,
    // in which case the Import button is disabled anyway (see the
    // `disabled` prop below) — this branch runs only after a live preview.
    onImport(finalItems, previewFormat !== undefined
      ? {
          source: sourceUrlAtImport,
          format: previewFormat,
          ...(previewExtraHeaders !== undefined ? { extraHeaders: previewExtraHeaders } : {}),
          ...(previewChecksum !== undefined ? { expectedChecksum: previewChecksum } : {})
        }
      : undefined)

    // Close modal (useEffect will clear state when modal closes)
    onClose()
  }, [previewItems, previewChecksum, previewFormat, previewExtraHeaders, selection, input, onImport, onClose, attachedAuth, manualHeaders, refreshContext])

  // Refresh-from-source bootstrap. When `refreshContext` is provided
  // we pre-fill the URL display + the auth pill from the env folder's
  // stored config, then fire the regular `import.preview` against
  // the stored URL with the persisted manual headers attached. Auth
  // attaches re-prefetch on user re-confirmation (via the auth-setup
  // sub-modal) — the import wizard already has UX for that.
  useEffect(() => {
    if (!isOpen || !refreshContext) return
    setInput(refreshContext.sourceUrl)
    setAttachedAuth(refreshContext.authenticationRequest ?? null)
    attachedAuthHeadersRef.current = null
    // Pre-fill the manual-headers KV table from the stored
    // `sourceHeaders` so the user can see / edit them before the
    // refresh fires. Auto-expand the collapsible when there's at
    // least one row to surface so it's discoverable.
    const stored = refreshContext.sourceHeaders ?? {}
    const storedRows = Object.entries(stored).map(([key, value]) => ({
      id: crypto.randomUUID(),
      key,
      value,
      enabled: true
    }))
    setManualHeaders(storedRows)
    if (storedRows.length > 0) setCustomHeadersOpen(true)
    setIsLoading(true)
    setError(null)
    const token = { cancelled: false }
    void (async () => {
      try {
        // `apiUpdate:refresh-fetch` runs the same fetch the Home
        // Refresh button uses — it resolves the env folder's auth
        // route + `${VAR}` headers on the main side, fetches the
        // URL, parses the payload, and returns items + checksum.
        // Doing the auth on main is mandatory: the renderer-side
        // `auth.prefetch` would forward the request raw, without
        // handlebars expansion against the env folder's ContextService.
        const api = window.restorm?.apiUpdate
        if (!api) {
          if (!token.cancelled) {
            setPreviewItems([])
            setPreviewChecksum(undefined)
            setError(t('import.error.unknown'))
            setLockedKeys(new Set())
          }
          return
        }
        const result = await api.refreshFetch(refreshContext.targetFolderId)
        if (token.cancelled) return
        if (result.ok) {
          // refreshFetch returns items as `unknown[]` at the IPC boundary;
          // they are FolderItems by contract (the main importer produced them).
          const items = result.items as FolderItem[]
          setPreviewItems(items)
          setPreviewChecksum(result.checksum)
          setError(null)
          // Re-derive `lockedKeys` from the intersection of the
          // existing folder's leaves with the freshly-fetched
          // preview. A request that disappeared from the source
          // spec drops out of the locked set so the wizard doesn't
          // try to force-check a key the tree no longer contains.
          const existing = refreshContext.existingLeafKeys
          if (existing && existing.size > 0) {
            const previewLeaves = allLeafKeys(items)
            const locked = new Set<string>()
            for (const key of existing) if (previewLeaves.has(key)) locked.add(key)
            setLockedKeys(locked)
          } else {
            setLockedKeys(new Set())
          }
        } else {
          setPreviewItems([])
          setPreviewChecksum(undefined)
          setError(result.error)
          setLockedKeys(new Set())
        }
      } catch (err) {
        if (!token.cancelled) {
          setPreviewItems([])
          setPreviewChecksum(undefined)
          setError(err instanceof Error ? err.message : String(err))
          setLockedKeys(new Set())
        }
      } finally {
        if (!token.cancelled) setIsLoading(false)
      }
    })()
    return () => { token.cancelled = true }
  }, [isOpen, refreshContext, t])

  // Dispatches a showcase bubble's action button (see `ImportFormat.actionId`
  // in `ImportFormatShowcase.tsx`). Only `grpc-reflection` sets one today.
  const handleShowcaseAction = useCallback((actionId: string) => {
    if (actionId === 'grpc-reflection') setShowGrpcReflectionModal(true)
  }, [])

  // The reflection import already produces a fully-formed `EnvironmentFolder`
  // (same shape `buildEnvironmentFolderFromParsedProto` gives a proto-file
  // import) — hand it straight to the same `onImport` this modal received,
  // then close both modals. No selection tree / apiUpdate stamping applies:
  // there's no partial-selection UX for a live connection, and a reflection
  // import tracks its own refresh via `protoDescriptorSet` + the request
  // tab's "Refresh from reflection" button, not `apiUpdate`.
  const handleGrpcReflectionImport = useCallback((items: FolderItem[]) => {
    setShowGrpcReflectionModal(false)
    onImport(items)
    onClose()
  }, [onImport, onClose])

  const handleAuthAttach = useCallback((authRequest: AuthenticationRequest, resolvedHeaders: Record<string, string>) => {
    setAttachedAuth(authRequest)
    attachedAuthHeadersRef.current = resolvedHeaders
    setShowAuthSetupModal(false)
    // Re-run the preview with the resolved auth headers.
    if (input.trim()) {
      handleInputChange(input)
    }
  }, [input, handleInputChange])

  const handleDetachAuth = useCallback(() => {
    setAttachedAuth(null)
    attachedAuthHeadersRef.current = null
    if (input.trim()) {
      handleInputChange(input)
    }
  }, [input, handleInputChange])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  // Whenever a fresh preview lands, default the selection.
  //
  // - Fresh import: every leaf checked, matching the legacy
  //   "import everything" UX.
  // - Refresh from source: only the locked leaves are pre-checked.
  //   A locked leaf is one whose natural key is already present in
  //   the target folder (intersection of `existingLeafKeys` with the
  //   preview's leaves, computed by the bootstrap effect). New
  //   operations arrive unchecked so they show up as opt-in
  //   additions; locked leaves are read-only — the user can't opt
  //   them out, which would silently drop a route already exposed
  //   by the folder.
  useEffect(() => {
    if (refreshContext) {
      setSelection(new Set(lockedKeys))
      return
    }
    setSelection(allLeafKeys(previewItems))
  }, [previewItems, refreshContext, lockedKeys])

  // Counter shown on the confirm button — only checked **and**
  // enabled leaves count. Locked leaves are forced-checked but the
  // user has no choice over them, so surfacing them in "Apply update
  // (N)" would mislead about how many routes the user is actually
  // opting into. Subtracting `lockedKeys.size` from `selection.size`
  // works because the modal always keeps every locked key in the
  // selection (init + folder toggle + select-none all preserve them).
  const selectedLeafCount = Math.max(0, selection.size - lockedKeys.size)

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setInput('')
      setPreviewItems([])
      setSelection(new Set())
      setLockedKeys(new Set())
      setSearchFilter('')
      setError(null)
      setIsLoading(false)
      setIsDraggingOver(false)
      setManualHeaders([])
      setCustomHeadersOpen(false)
    }
  }, [isOpen])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={refreshContext
        ? t('import.refreshTitle', 'Refresh from source')
        : t('import.title')}
      data-testid="import-modal-dialog"
    >
      <div
        className="import-modal"
        data-testid="import-modal"
        data-refresh-mode={refreshContext ? 'true' : undefined}
        data-dragging-over={isDraggingOver ? 'true' : undefined}
        onDragEnter={handleModalDragEnter}
        onDragLeave={handleModalDragLeave}
        onDragOver={handleModalDragOver}
        onDrop={handleModalDrop}
      >

        {/* Source Input */}
        <div className="import-section">
          <label className="import-label">
            {t('import.source.label')}
          </label>
          {refreshContext ? (
            // Refresh mode: the URL is bound to the env folder's
            // stored apiUpdate config and isn't editable here. Render
            // it read-only so the user still sees what's being
            // refreshed.
            <div
              data-testid="source-input-readonly"
              style={{
                padding: '6px 10px',
                borderRadius: 4,
                border: '1px solid var(--input-border, #555)',
                background: 'var(--input-background, #1e1e1e)',
                color: 'var(--input-foreground, #ddd)',
                fontFamily: 'monospace',
                fontSize: 12,
                wordBreak: 'break-all'
              }}
            >
              {refreshContext.sourceUrl}
            </div>
          ) : (
            <InputBox
              value={input}
              onChange={handleInputChange}
              options={{
                placeholder: t('import.source.placeholder'),
                flexibleHeight: true,
                flexibleMaxHeight: 200
              }}
              data-testid="source-input"
            />
          )}
          {isLoading && (
            <div className="import-loading" role="status">
              <i className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
              {t('import.loading')}
            </div>
          )}
          {error && (
            <div className="import-error" role="alert" data-testid="import-error-message">
              <i className="codicon codicon-error" aria-hidden="true" />
              <span style={{ flex: 1 }}>{error}</span>
            </div>
          )}
          {/* Auth-route attach + manual headers are always available —
              not just on 401/403 — so users can pre-wire APIs that
              need a token even when the first request otherwise
              succeeds (or on file-based imports). Both buttons sit
              on the same row so the "auth-shaped vs one-shot
              headers" choice is presented at the same visual level. */}
          <div style={{ display: 'inline-flex', gap: 8, alignSelf: 'flex-start', flexWrap: 'wrap' }}>
            {!attachedAuth && (
              <Button
                icon="key"
                onClick={() => { setShowAuthSetupModal(true) }}
                options={{
                  ariaLabel: t('import.addAuth', 'Add an authentication route')
                }}
                data-testid="import-add-auth-button"
              >
                {t('import.addAuth', 'Add an authentication route')}
              </Button>
            )}
            <Button
              onClick={() => { setCustomHeadersOpen(true) }}
              options={{
                ariaLabel: t('import.customHeadersBtn', 'Add custom headers'),
                title: t('import.customHeadersBtnTitle', 'Attach one-shot headers to the spec fetch (saved on the imported folder for re-imports)')
              }}
              data-testid="import-custom-headers-button"
            >
              {t('import.customHeadersBtn', 'Add custom headers')}
              {manualHeaders.filter((row) => row.enabled && row.key.trim().length > 0).length > 0 && (
                <span className="import-custom-headers__count" style={{ marginLeft: 6 }} aria-hidden="true">
                  {manualHeaders.filter((row) => row.enabled && row.key.trim().length > 0).length}
                </span>
              )}
            </Button>
          </div>
          {attachedAuth ? (
            <div
              className="import-auth-pill"
              data-testid="import-auth-pill"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 4px 4px 8px',
                borderRadius: 12,
                background: '#f97316',
                color: '#ffffff',
                fontSize: 12,
                alignSelf: 'flex-start'
              }}
            >
              <Button
                line
                options={{ ariaLabel: t('import.editAuth', 'Edit authentication route') }}
                data-testid="import-edit-auth-button"
                onClick={() => { setShowAuthSetupModal(true) }}
                style={{ color: 'inherit', background: 'transparent', padding: 0 }}
              >
                <i className="codicon codicon-key" aria-hidden="true" />
                <span>{t('import.authenticatedVia', 'Authenticated via {{name}}', { name: attachedAuth.name || 'auth route' })}</span>
              </Button>
              <Button
                small
                icon="close"
                onClick={handleDetachAuth}
                options={{
                  ariaLabel: t('import.detachAuth', 'Detach authentication route')
                }}
                data-testid="import-detach-auth-button"
              />
            </div>
          ) : null}
        </div>

        {/* Drop zone — visible target for file drops onto the modal.
            Hidden when the route-preview tree is on screen UNLESS a
            drag is currently happening over the modal: in that case
            we want the user's intent (drop something) to flip the UI
            back to the dashed-rectangle target without losing the
            preview list (which re-mounts on dragleave). The dashed
            border colour flips to whichever of black / white reads
            on the modal's background; recomputed on each open via
            the `useLayoutEffect` above. */}
        {(displayedSection !== 'preview' || isDraggingOver) && (
          <div
            ref={dropZoneRef}
            className={`import-drop-zone${isDraggingOver ? ' import-drop-zone--active' : ''}`}
            style={{ '--import-drop-zone-color': dropZoneColor } as React.CSSProperties}
            data-testid="import-drop-zone"
          >
            <span className="import-drop-zone-label" aria-hidden="true">
              {t('import.dropZone', 'Drop zone')}
            </span>

            {/* Big "drop here" cue. The codicon glyph is wrapped in
                a Wordmark with `effect="random"` — same treatment as
                the welcome-screen wordmark, so each new drag picks a
                fresh enter animation (text-3d-flip / dia-text-reveal
                / text-animate / hyper-text). The icon is the
                `arrow-circle-down` codicon (U+EBFC); font-family +
                font-size are set in CSS so every span Wordmark mints
                inherits them. With the codicon font loaded, the
                hyper-text variant scrambles the cue through other
                codicon glyphs before settling — happy accident, no
                special-casing needed. Mounted only while a drag is
                over the modal so the enter animation plays once on
                mount and that's the cue's flair. */}
            {isDraggingOver && (
              <div className="import-drop-zone-cue" aria-hidden="true">
                <Wordmark effect="random">{"\uebfc"}</Wordmark>
              </div>
            )}

            {/* Format showcase — pitches one supported import format at
                a time when there's nothing to preview yet. Hidden in
                refresh mode (the user already chose a format the day
                they imported) and while a drag is over the modal (the
                drop-cue takes its place).

                The wrapper carries the cross-section fade class
                (`leaving` / `entering`) driven by the `transitionPhase`
                state. `key={showcaseMountSeq}` forces a fresh
                `<ImportFormatShowcase>` mount each time we come back
                from the preview tree so the rotation engine restarts
                from index 0 instead of resuming mid-cycle. */}
            {displayedSection === 'showcase' && !refreshContext && !isDraggingOver && (
              <div className={`import-section-fade${transitionPhase !== null ? ` import-section-fade--${transitionPhase}` : ''}`}>
                <ImportFormatShowcase key={showcaseMountSeq} onAction={handleShowcaseAction} />
              </div>
            )}

            {!isLoading && !error && previewItems.length === 0 && input.trim() !== '' && (
              <div className="import-no-results" role="status">
                <i className="codicon codicon-info" aria-hidden="true" />
                {t('import.noResults')}
              </div>
            )}
          </div>
        )}

        {/* Section 3: Two-tab preview — the Routes tree (tri-state
            checkboxes + filter) and a read-only Documentation view of
            the parsed spec. Rendered as a sibling of the drop-zone
            wrapper rather than a child, so the preview can occupy
            the same flex slot without inheriting the dashed border /
            drop-cue treatment. Hidden during an active drag so the
            drop-zone takes the slot back; `previewItems` stays in
            state, so the list re-mounts identically on dragleave. */}
        {displayedSection === 'preview' && !isDraggingOver && (
          <div className={`import-section import-preview-section import-section-fade${transitionPhase !== null ? ` import-section-fade--${transitionPhase}` : ''}`}>
            <ImportPreviewTabs
              previewItems={previewItems}
              selection={selection}
              onSelectionChange={setSelection}
              searchFilter={searchFilter}
              onSearchFilterChange={setSearchFilter}
              lockedKeys={lockedKeys}
            />
          </div>
        )}

        {/* Actions */}
        <div className="import-actions">
          <Button secondary onClick={onClose} data-testid="cancel-button">
            {t('import.cancel')}
          </Button>
          <Button
            emphasis={1}
            onClick={handleImportClick}
            disabled={previewItems.length === 0 || selection.size === 0}
            data-testid="import-button"
          >
            {(() => {
              const baseLabel = refreshContext
                ? t('import.applyUpdate', 'Apply update')
                : t('import.ok')
              return selectedLeafCount > 0
                ? t('import.okN', '{{action}} ({{count}})', { action: baseLabel, count: selectedLeafCount })
                : baseLabel
            })()}
          </Button>
        </div>
      </div>

      <AuthenticationSetupModal
        isOpen={showAuthSetupModal}
        onClose={() => { setShowAuthSetupModal(false) }}
        onAttach={handleAuthAttach}
        {...(attachedAuth ? { initialRequest: attachedAuth } : {})}
      />

      <GrpcReflectionImportModal
        isOpen={showGrpcReflectionModal}
        onClose={() => { setShowGrpcReflectionModal(false) }}
        onImport={handleGrpcReflectionImport}
      />

      {/* Manual headers sub-modal. Editing happens on the parent's
          `manualHeaders` state in real time, so the preview
          re-fetches as the user types just like with the inline
          version. Done button closes; row dirty-state is the
          parent's single source of truth. */}
      <Modal
        isOpen={customHeadersOpen}
        onClose={() => { setCustomHeadersOpen(false) }}
        title={t('import.customHeadersBtn', 'Custom headers')}
        data-testid="import-custom-headers-modal"
        size="dialog"
      >
        <div className="import-custom-headers__body" data-testid="import-custom-headers-body">
          <p className="import-custom-headers__hint">
            {t('import.customHeadersHint', 'Headers are stored on the imported folder so a future Refresh-from-source replays them. For login flows with token rotation, use the Auth-route attach above instead.')}
          </p>
          <KeyValueTable
            ref={customHeadersTableRef}
            data-testid="import-custom-headers-table"
            showDescription={false}
            initialRows={manualHeaders}
            onRowsChange={(rows: KeyValueTableRow[]) => {
              setManualHeaders(rows.map((r) => ({
                id: r.id ?? crypto.randomUUID(),
                key: r.key,
                value: r.value,
                enabled: r.enabled ?? true
              })))
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, gap: 8 }}>
            <Button
              icon="add"
              data-testid="import-custom-headers-add-row"
              onClick={() => { customHeadersTableRef.current?.addRow() }}
            >
              {t('import.customHeadersAdd', 'Add header')}
            </Button>
            <Button
              onClick={() => { setCustomHeadersOpen(false) }}
              data-testid="import-custom-headers-done"
            >
              {t('import.customHeadersDone', 'Done')}
            </Button>
          </div>
        </div>
      </Modal>
    </Modal>
  )
}

/**
 * Two-tab preview area inside the Import modal: the Routes tab
 * surfaces the selectable tree the wizard always had; the
 * Documentation tab renders the parsed spec read-only via
 * `DocumentationHost`. Locked-keys + the search filter live in the
 * parent so switching tabs doesn't reset state.
 *
 * Pulling the parsed `apiDocumentation` off the first env-folder in
 * the preview items keeps the doc tab in sync with the routes tab —
 * the import preview always emits an env folder per format, and the
 * documentation lives on that folder.
 */
interface ImportPreviewTabsProps {
  previewItems: FolderItem[]
  selection: Set<string>
  onSelectionChange: (sel: Set<string>) => void
  searchFilter: string
  onSearchFilterChange: (filter: string) => void
  lockedKeys: ReadonlySet<string>
}

type ImportPreviewTabId = 'routes' | 'documentation'

const ImportPreviewTabs: React.FC<ImportPreviewTabsProps> = ({
  previewItems,
  selection,
  onSelectionChange,
  searchFilter,
  onSearchFilterChange,
  lockedKeys
}) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<ImportPreviewTabId>('routes')

  const apiDocumentation = useMemo<ApiDocumentation | undefined>(() => {
    for (const item of previewItems) {
      if (isEnvironmentFolder(item)) {
        const doc = (item as unknown as { apiDocumentation?: ApiDocumentation }).apiDocumentation
        if (doc) return doc
      }
    }
    return undefined
  }, [previewItems])

  const previewTabs: Tab[] = [
    {
      id: 'routes',
      label: t('import.tabs.routes', 'Routes'),
      useScrollableElement: false,
      content: (
        <div
          className="import-preview-routes-tab"
          data-testid="import-preview-tabs-tabpanel-routes"
        >
          <div className="import-preview-header">
            <div className="import-preview-actions">
              <Button
                secondary
                onClick={() => { onSelectionChange(allLeafKeys(previewItems)) }}
                data-testid="import-select-all-button"
              >
                {t('import.selectAll', 'Select all')}
              </Button>
              <Button
                secondary
                onClick={() => {
                  // Locked leaves stay checked even on "Select none"
                  // — opting them out would silently drop a route the
                  // target folder already exposes.
                  onSelectionChange(new Set(lockedKeys))
                }}
                data-testid="import-select-none-button"
              >
                {t('import.selectNone', 'Select none')}
              </Button>
            </div>
          </div>
          <div className="import-preview-search">
            <InputBox
              value={searchFilter}
              onChange={onSearchFilterChange}
              options={{ placeholder: t('import.searchPlaceholder', 'Filter routes / folders…') }}
              data-testid="import-selection-search"
            />
          </div>
          <div className="import-preview">
            <ImportSelectionTree
              items={previewItems}
              selection={selection}
              onSelectionChange={onSelectionChange}
              searchFilter={searchFilter}
              lockedKeys={lockedKeys}
              data-testid="import-selection-tree"
            />
          </div>
        </div>
      )
    },
    {
      id: 'documentation',
      label: t('import.tabs.documentation', 'Documentation'),
      useScrollableElement: false,
      content: (
        <div
          className="import-preview-doc-tab"
          data-testid="import-preview-tabs-tabpanel-documentation"
        >
          {apiDocumentation
            ? (
              <DocumentationHost
                apiDocumentation={apiDocumentation}
                showApiInfo
                hideAddRequest
                testId="import-preview-documentation"
              />
              )
            : (
              <div className="import-preview-doc-empty" data-testid="import-preview-documentation-empty">
                {t('import.preview.noDocumentation', 'No parsed documentation for this source.')}
              </div>
              )}
        </div>
      )
    }
  ]

  return (
    <Tabs
      tabs={previewTabs}
      activeTabId={activeTab}
      onTabChange={(id) => { setActiveTab(id as ImportPreviewTabId) }}
      mountStrategy="active-only"
      data-testid="import-preview-tabs"
    />
  )
}
