/**
 * ImportModal - Modal for importing requests from various sources
 */

import React, { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import {
  Modal,
  Button,
  InputBox,
  Wordmark,
  getContrastColor
} from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import type { FolderItem, EnvironmentFolder } from '../../../../shared/types/collections'
import { isEnvironmentFolder, isRequest } from '../../../../shared/types/collections'
import type { AuthenticationRequest } from '../../../../shared/models'
import { logger } from 'electron-core-ui/renderer'
import { AuthenticationSetupModal } from './AuthenticationSetupModal'
import { ImportFormatShowcase } from './ImportFormatShowcase'
import { ImportSelectionTree } from './ImportSelectionTree'
import { allLeafKeys } from './importSelectionHelpers'
import { filterImportTreeBySelection } from '../../../../shared/utils/importNaturalKey'
import './ImportModal.css'

/**
 * Optional payload that flips the modal into "Refresh from source"
 * mode. When set, the modal:
 *
 * - Pre-fills the source URL + the attached auth route from the
 *   already-imported env folder. Both fields are display-only —
 *   they're sourced from the env folder's stored apiUpdate config
 *   and aren't editable in this flow.
 * - Calls `apiUpdate.previewTree(targetFolderId)` to get the parsed
 *   preview tree + the set of leaves whose operation already lives
 *   in the target. Locked leaves arrive checked + disabled (the user
 *   can't opt them out without losing a route the folder already
 *   exposes); other leaves arrive unchecked and surface as opt-in
 *   additions.
 * - Replaces the "Import" button with "Apply update" and routes the
 *   confirm action to `apiUpdate.apply` instead of the fresh-import
 *   handler. The callback receives the resulting payload so the host
 *   can splice the new requests onto its own copy of the env folder.
 */
export interface RefreshContext {
  sourceUrl: string
  authenticationRequest?: AuthenticationRequest
  targetFolderId: string
  onApplied: (updatedFolder: unknown) => void
}

export interface ImportModalProps {
  isOpen: boolean
  onClose: () => void
  onImport: (items: FolderItem[]) => void
  refreshContext?: RefreshContext
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
  /**
   * Set of leaf natural keys whose checkbox is forced-on + disabled
   * because their operation already exists in the target folder.
   * Populated from `apiUpdate.previewTree`'s `lockedKeys` array on
   * refresh-from-source, empty in fresh-import mode.
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
          // Read through the ref so the current value lands in the
          // fetch options even when state updates haven't propagated
          // through the closure yet (auth-attach re-preview path).
          const currentHeaders = attachedAuthHeadersRef.current
          const previewOptions = currentHeaders !== null
            ? { extraHeaders: currentHeaders }
            : undefined
          const result = await window.restorm?.import.preview(value.trim(), previewOptions)

          if (result?.success) {
            setPreviewItems(result.items as FolderItem[])
            setError(null)
          } else {
            setPreviewItems([])
            setError(result?.error ?? t('import.error.unknown'))
          }
        } catch (err) {
          setPreviewItems([])
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setIsLoading(false)
        }
      })()
    }, 200)
  }, [t])

  // Modal-wide drag tracking. Bound on the `.import-modal` div so
  // any drag entering the dialog (regardless of which inner element
  // it lands on first) hides the showcase + tints the drop-zone
  // fill. Counter increments on every dragenter and decrements on
  // every dragleave; when it returns to zero we know the cursor has
  // truly left — including the case where the user drops outside or
  // releases the drag mid-flight.
  const handleModalDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    // Skip drags carrying nothing useful (e.g. an internal element
    // dragstart that didn't set any data) — without this we'd flip
    // the modal into drop-mode for a stray text-selection drag.
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
      void (async () => {
        try {
          const api = (window as unknown as {
            restorm?: { apiUpdate?: { apply: (id: string, sel: { include: string[]; skip: string[] }) => Promise<{ updatedFolder: unknown }> } }
          }).restorm?.apiUpdate
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
        const firstFolder = attachedTree[firstFolderIdx] as Extract<FolderItem, { items: FolderItem[] }>
        finalItems = [
          ...attachedTree.slice(0, firstFolderIdx),
          { ...firstFolder, items: [attachedAuth as unknown as FolderItem, ...firstFolder.items] },
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
    const stampApiUpdate = (items: FolderItem[]): FolderItem[] => items.map((item) => {
      if (!isEnvironmentFolder(item)) return item
      const stamped = { ...item } as EnvironmentFolder
      if (isUrlImport) {
        const existing = (stamped as unknown as { apiUpdate?: Record<string, unknown> }).apiUpdate ?? {}
        const apiDoc = (stamped as unknown as { apiDocumentation?: { api?: { version?: string } } }).apiDocumentation
        ;(stamped as unknown as { apiUpdate?: Record<string, unknown> }).apiUpdate = {
          sourceUrl: sourceUrlAtImport,
          autoCheckEnabled: false,
          interval: 'daily',
          ...(apiDoc?.api?.version !== undefined ? { lastImportedSpecVersion: apiDoc.api.version } : {}),
          ...existing,
          ...(attachedAuth ? { authenticationRequestId: attachedAuth.id } : {})
        }
      } else if (attachedAuth) {
        // File imports don't get a sourceUrl, but if the user
        // attached an auth route we still capture it for any manual
        // URL the user types into the env-folder home.
        const apiUpdate = (stamped as unknown as { apiUpdate?: Record<string, unknown> }).apiUpdate ?? {}
        ;(stamped as unknown as { apiUpdate?: Record<string, unknown> }).apiUpdate = {
          ...apiUpdate,
          authenticationRequestId: attachedAuth.id
        }
      }
      return stamped
    })
    finalItems = stampApiUpdate(finalItems)

    // Imports always land at the project root — the destination
    // picker (and the per-import "new folder" creation that went with
    // it) is gone until the import-screen redesign defines a path
    // that's actually wired through the persistence layer.
    onImport(finalItems)

    // Close modal (useEffect will clear state when modal closes)
    onClose()
  }, [previewItems, selection, input, onImport, onClose, attachedAuth, refreshContext])

  // Refresh-from-source bootstrap. When `refreshContext` is provided
  // we pre-fill the URL display + the auth pill from the env folder's
  // stored config, then ask main to do the preview. Main runs the
  // saved auth route through the env's first environment (so any
  // `{{var}}`-style placeholders get resolved before /login fires)
  // and returns the parsed-spec tree. Skipping the renderer-side
  // auth.prefetch path is what makes refresh handle Handlebars-style
  // variables the same way the apply path does.
  useEffect(() => {
    if (!isOpen || !refreshContext) return
    setInput(refreshContext.sourceUrl)
    setAttachedAuth(refreshContext.authenticationRequest ?? null)
    attachedAuthHeadersRef.current = null
    setIsLoading(true)
    setError(null)
    const token = { cancelled: false }
    void (async () => {
      try {
        const api = (window as unknown as {
          restorm?: { apiUpdate?: { previewTree?: (id: string) => Promise<{ success: boolean; items: unknown[]; lockedKeys?: string[]; error?: string }> } }
        }).restorm?.apiUpdate
        if (!api?.previewTree) throw new Error('apiUpdate.previewTree IPC unavailable')
        const result = await api.previewTree(refreshContext.targetFolderId)
        if (token.cancelled) return
        if (result.success) {
          setPreviewItems(result.items as FolderItem[])
          setLockedKeys(new Set(result.lockedKeys ?? []))
          setError(null)
        } else {
          setPreviewItems([])
          setLockedKeys(new Set())
          setError(result.error ?? t('import.error.unknown'))
        }
      } catch (err) {
        if (!token.cancelled) {
          setPreviewItems([])
          setLockedKeys(new Set())
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!token.cancelled) setIsLoading(false)
      }
    })()
    return () => { token.cancelled = true }
  }, [isOpen, refreshContext, t])

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
  //   A locked leaf is one whose operation is already present in the
  //   target folder (per the same `findOperationForRoute` matcher
  //   that drives Docs-tab visibility). New operations arrive
  //   unchecked so they show up as opt-in additions; locked leaves
  //   are read-only (the user can't opt them out). An empty
  //   `lockedKeys` set in refresh mode would surface every fresh
  //   route as a brand-new addition — that's the right default since
  //   it means the existing folder doesn't cover any of the spec's
  //   current operations.
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
            <div className="import-error" role="alert">
              <i className="codicon codicon-error" aria-hidden="true" />
              <span style={{ flex: 1 }}>{error}</span>
            </div>
          )}
          {/* Auth-route attach is always available — not just on 401/403 —
              so users can pre-wire APIs that need a token even when the
              first request otherwise succeeds (or on file-based imports). */}
          {!attachedAuth ? (
            <div style={{ alignSelf: 'flex-start' }}>
              <Button
                icon="key"
                onClick={() => { setShowAuthSetupModal(true) }}
                options={{
                  ariaLabel: t('import.addAuth', 'Add an authentication route'),
                  title: t('import.addAuth', 'Add an authentication route')
                }}
                data-testid="import-add-auth-button"
              >
                {t('import.addAuth', 'Add an authentication route')}
              </Button>
            </div>
          ) : null}
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
              <button
                type="button"
                onClick={() => { setShowAuthSetupModal(true) }}
                title={t('import.editAuth', 'Edit authentication route')}
                aria-label={t('import.editAuth', 'Edit authentication route')}
                data-testid="import-edit-auth-button"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  border: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  padding: 0,
                  cursor: 'pointer',
                  font: 'inherit'
                }}
              >
                <i className="codicon codicon-key" aria-hidden="true" />
                <span>{t('import.authenticatedVia', 'Authenticated via {{name}}', { name: attachedAuth.name || 'auth route' })}</span>
              </button>
              <Button
                small
                icon="close"
                onClick={handleDetachAuth}
                options={{
                  ariaLabel: t('import.detachAuth', 'Detach authentication route'),
                  title: t('import.detachAuth', 'Detach authentication route')
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
                a Wordmark so it gets the same entrance flair as the
                rest of the showcase typography — `text-3d-flip` is
                the only built-in effect that animates a single glyph
                cleanly (the others either scramble or stagger across
                multiple characters). The actual icon is the
                `arrow-circle-down` codicon (\\uebfc); font-family +
                font-size are set on the wrapper so every span
                Wordmark mints inherits them. */}
            {isDraggingOver && (
              <div className="import-drop-zone-cue" aria-hidden="true">
                <Wordmark effect="text-3d-flip">{''}</Wordmark>
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
                <ImportFormatShowcase key={showcaseMountSeq} />
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

        {/* Section 3: Selection tree (preview + tri-state checkboxes).
            Rendered as a sibling of the drop-zone wrapper rather than
            a child, so the preview can occupy the same flex slot
            without inheriting the dashed border / drop-cue treatment
            — a busy import flow shouldn't compete with the drop-zone
            decoration. Hidden during an active drag so the drop-zone
            takes the slot back; `previewItems` stays in state, so the
            list re-mounts identically on dragleave. */}
        {displayedSection === 'preview' && !isDraggingOver && (
          <div className={`import-section import-preview-section import-section-fade${transitionPhase !== null ? ` import-section-fade--${transitionPhase}` : ''}`}>
            <div className="import-preview-header">
              <label className="import-label">
                {t('import.preview.label')}
              </label>
              <div className="import-preview-actions">
                <Button
                  secondary
                  onClick={() => { setSelection(allLeafKeys(previewItems)) }}
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
                    setSelection(new Set(lockedKeys))
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
                onChange={setSearchFilter}
                options={{ placeholder: t('import.searchPlaceholder', 'Filter routes / folders…') }}
                data-testid="import-selection-search"
              />
            </div>
            <div className="import-preview">
              <ImportSelectionTree
                items={previewItems}
                selection={selection}
                onSelectionChange={setSelection}
                searchFilter={searchFilter}
                lockedKeys={lockedKeys}
                data-testid="import-selection-tree"
              />
            </div>
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
    </Modal>
  )
}
