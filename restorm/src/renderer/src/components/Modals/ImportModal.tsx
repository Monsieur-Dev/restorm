/**
 * ImportModal - Modal for importing requests from various sources
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
  Modal,
  Button,
  InputBox,
  type ListViewItemData,
  ListViewDropdown
} from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import type { FolderItem, EnvironmentFolder, Folder, ImportSelectionSnapshot } from '../../../../shared/types/collections'
import { isEnvironmentFolder, isRequest } from '../../../../shared/types/collections'
import type { AuthenticationRequest } from '../../../../shared/models'
import { logger } from 'electron-core-ui/renderer'
import { AuthenticationSetupModal } from './AuthenticationSetupModal'
import { ImportSelectionTree } from './ImportSelectionTree'
import { allLeafKeys } from './importSelectionHelpers'
import { filterImportTreeBySelection } from '../../../../shared/utils/importNaturalKey'
import './ImportModal.css'

interface PendingFolder {
  id: string
  name: string
  parentId: string
}

/**
 * Optional payload that flips the modal into "Refresh from source"
 * mode. When set, the modal:
 *
 * - Pre-fills the source URL + the attached auth route from the
 *   already-imported env folder (the destination dropdown is hidden
 *   because the target is fixed).
 * - Pre-selects the leaves whose natural keys appear in
 *   `alreadyImportedKeys`. An empty / null list means "everything was
 *   imported (or this is a first-time import with no snapshot)" — in
 *   either case we want every leaf checked, matching the legacy
 *   import-everything default.
 * - Replaces the "Import" button with "Apply update" and routes the
 *   confirm action to `window.restorm.apiUpdate.apply` instead of the
 *   fresh-import handler. The callback receives the resulting
 *   payload so the host can splice the new requests onto its own
 *   copy of the env folder.
 */
export interface RefreshContext {
  sourceUrl: string
  authenticationRequest?: AuthenticationRequest
  alreadyImportedKeys?: string[]
  targetFolderId: string
  onApplied: (updatedFolder: unknown) => void
}

export interface ImportModalProps {
  isOpen: boolean
  onClose: () => void
  onImport: (items: FolderItem[], targetFolderId?: string, pendingFolders?: PendingFolder[]) => void
  rootFolder?: EnvironmentFolder
  selectedFolderId?: string | undefined
  refreshContext?: RefreshContext
}

export function ImportModal({
  isOpen,
  onClose,
  onImport,
  rootFolder,
  selectedFolderId,
  refreshContext
}: ImportModalProps): React.JSX.Element {
  const { t } = useTranslation()
  
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
  const [targetFolderId, setTargetFolderId] = useState<string | undefined>(undefined)
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>(['__root__'])
  const [pendingFolders, setPendingFolders] = useState<PendingFolder[]>([])
  const [showFolderNameInput, setShowFolderNameInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Initialize targetFolderId from selectedFolderId or find parent folder
  useEffect(() => {
    if (!isOpen || !rootFolder) return

    if (selectedFolderId) {
      // Find if selectedFolderId is a folder or a request
      const findItem = (items: FolderItem[], id: string): { item: FolderItem; parent?: Folder | EnvironmentFolder } | null => {
        for (const item of items) {
          if (item.id === id) {
            return { item }
          }
          if ('items' in item) {
            const found = findItem((item).items, id)
            if (found) {
              return { item: found.item, parent: item }
            }
          }
        }
        return null
      }

      const found = findItem(rootFolder.items, selectedFolderId)
      if (found) {
        // If it's a folder, use it; if it's a request, use its parent
        if ('items' in found.item) {
          setTargetFolderId(found.item.id)
        } else if (found.parent) {
          setTargetFolderId(found.parent.id)
        } else {
          setTargetFolderId(undefined) // Root
        }
      } else {
        setTargetFolderId(undefined)
      }
    } else {
      setTargetFolderId(undefined)
    }
  }, [isOpen, selectedFolderId, rootFolder])

  // Build folder items for dropdown with root option
  const folderItems: ListViewItemData[] = useMemo(() => {
    if (!rootFolder) return []
    
    // Recursively build folder tree, including both Folders and EnvironmentFolders
    const buildFolderTree = (items: FolderItem[], parentId: string): ListViewItemData[] => {
      const folderListItems = items
        .filter(item => 'items' in item) // Only folders (both Folder and EnvironmentFolder)
        .map(item => {
          const folder = item
          const isEnvFolder = isEnvironmentFolder(item)
          
          const folderItem: ListViewItemData = {
            id: folder.id,
            title: folder.name,
            icon: isEnvFolder ? 'folder-library' : 'folder',
            isExpandable: false,
            children: folder.items.length > 0 ? buildFolderTree(folder.items, folder.id) : []
          }
          return folderItem
        })
      
      // Add pending folders for this parent
      const pendingForThisParent = pendingFolders
        .filter(pf => pf.parentId === parentId)
        .map(pf => ({
          id: pf.id,
          title: pf.name,
          icon: 'folder' as const,
          isExpandable: false,
          children: []
        }))
      
      return [...folderListItems, ...pendingForThisParent]
    }
    
    // Start by building from root's items (which includes all EnvironmentFolders)
    const rootChildren = buildFolderTree(rootFolder.items, '__root__')
    
    // Add root option at the top level
    const rootItem: ListViewItemData = {
      id: '__root__',
      title: t('import.destination.root'),
      icon: 'folder-opened',
      children: rootChildren
    }
    
    return [rootItem]
  }, [rootFolder, t, pendingFolders])
  
  // Initialize expanded folders when rootFolder changes
  useEffect(() => {
    if (!rootFolder) return
    
    const allFolderIds: string[] = []
    const collectIds = (items: FolderItem[]): void => {
      items.forEach(item => {
        if ('items' in item) {
          const folder = item
          allFolderIds.push(folder.id)
          if (folder.items.length > 0) {
            collectIds(folder.items)
          }
        }
      })
    }
    collectIds(rootFolder.items)
    setExpandedFolderIds(['__root__', ...allFolderIds])
  }, [rootFolder])
  
  // Get the display name for the selected folder
  const selectedFolderName = useMemo(() => {
    logger.info('[ImportModal] selectedFolderName recalc', { targetFolderId, pendingFoldersCount: pendingFolders.length })
    if (!targetFolderId || targetFolderId === '__root__') {
      return t('import.destination.root')
    }
    
    // Check if it's a pending folder first
    const pendingFolder = pendingFolders.find(pf => pf.id === targetFolderId)
    if (pendingFolder) {
      logger.info('[ImportModal] Found pending folder', { name: pendingFolder.name })
      return pendingFolder.name
    }
    logger.info('[ImportModal] No pending folder found for', { targetFolderId })
    
    if (!rootFolder) return ''
    
    const findFolderName = (items: FolderItem[], id: string): string | null => {
      for (const item of items) {
        if (item.id === id && 'items' in item) {
          return (item).name
        }
        if ('items' in item) {
          const found = findFolderName((item).items, id)
          if (found) return found
        }
      }
      return null
    }
    
    return findFolderName(rootFolder.items, targetFolderId) ?? t('import.destination.root')
  }, [targetFolderId, rootFolder, t, pendingFolders])

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

  // Handle drag and drop
  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()

    const files = event.dataTransfer.files
    if (files.length > 0) {
      const file = files[0]
      if (file) {
        handleInputChange((file as { path?: string }).path ?? file.name)
      }
    }
  }, [handleInputChange])

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  // Handle new folder creation
  const handleCreateFolder = useCallback(() => {
    if (!newFolderName.trim()) return
    
    const newFolder: PendingFolder = {
      id: `pending-${crypto.randomUUID()}`,
      name: newFolderName.trim(),
      parentId: targetFolderId ?? '__root__'
    }
    logger.info('[ImportModal] handleCreateFolder', { newFolder, currentTargetId: targetFolderId, previewItemsCount: previewItems.length, inputLength: input.length })
    
    setPendingFolders(prev => {
      logger.info('[ImportModal] setPendingFolders', { prevCount: prev.length, newCount: prev.length + 1 })
      return [...prev, newFolder]
    })
    setTargetFolderId(newFolder.id)
    logger.info('[ImportModal] setTargetFolderId to', { newFolderId: newFolder.id })
    setExpandedFolderIds(prev => [...prev, newFolder.parentId, newFolder.id])
    setShowFolderNameInput(false)
    setNewFolderName('')
  }, [newFolderName, targetFolderId, previewItems.length, input.length])

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

    // Stamp every top-level env folder in the imported tree with the
    // user's selective-import choice so a future refresh can classify
    // the diff into added / removed / kept-skipped. The pair
    // (`imported`, `skipped`) covers the spec at capture time:
    // `imported` is the live selection, `skipped` is everything else
    // that was offered in the preview. The two lists are always
    // disjoint and exhaustive over the pre-filter leaf set.
    const allKeysAtCapture = allLeafKeys(previewItems)
    const imported = Array.from(selection).sort()
    const skipped = Array.from(allKeysAtCapture).filter((k) => !selection.has(k)).sort()
    const snapshot: ImportSelectionSnapshot = {
      capturedAt: Date.now(),
      source: input.trim(),
      imported,
      skipped
    }
    const sourceUrlAtImport = input.trim()
    const isUrlImport = sourceUrlAtImport.startsWith('http://') || sourceUrlAtImport.startsWith('https://')
    const stampSnapshot = (items: FolderItem[]): FolderItem[] => items.map((item) => {
      if (isEnvironmentFolder(item)) {
        const stamped = { ...item, importSelection: snapshot } as EnvironmentFolder
        // Stamp the apiUpdate config so a future refresh has every
        // field the orchestrator needs: the URL we just fetched
        // from, the static defaults from the migration, and the
        // attached auth-route id when the user supplied one. Tying
        // sourceUrl in here — instead of leaving it to the legacy
        // migration step — means the "Refresh from source" entry
        // shows up immediately after the import, without waiting
        // for the next project reload.
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
          // attached an auth route we still capture it for any
          // manual URL the user types into the env-folder home.
          const apiUpdate = (stamped as unknown as { apiUpdate?: Record<string, unknown> }).apiUpdate ?? {}
          ;(stamped as unknown as { apiUpdate?: Record<string, unknown> }).apiUpdate = {
            ...apiUpdate,
            authenticationRequestId: attachedAuth.id
          }
        }
        return stamped
      }
      return item
    })
    finalItems = stampSnapshot(finalItems)

    // Call import with current pending folders
    onImport(finalItems, targetFolderId, pendingFolders)

    // Close modal (useEffect will clear state when modal closes)
    onClose()
  }, [previewItems, selection, input, targetFolderId, pendingFolders, onImport, onClose, attachedAuth, refreshContext])

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
          restorm?: { apiUpdate?: { previewTree?: (id: string) => Promise<{ success: boolean; items: unknown[]; error?: string }> } }
        }).restorm?.apiUpdate
        if (!api?.previewTree) throw new Error('apiUpdate.previewTree IPC unavailable')
        const result = await api.previewTree(refreshContext.targetFolderId)
        if (token.cancelled) return
        if (result.success) {
          setPreviewItems(result.items as FolderItem[])
          setError(null)
        } else {
          setPreviewItems([])
          setError(result.error ?? t('import.error.unknown'))
        }
      } catch (err) {
        if (!token.cancelled) {
          setPreviewItems([])
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

  // Whenever a fresh preview lands, default the selection. Two modes:
  //
  // - Fresh import: every leaf checked, matching the legacy
  //   "import everything" UX.
  // - Refresh from source with a non-empty `alreadyImportedKeys`:
  //   only the leaves the user previously opted into are pre-checked
  //   (they appear as "kept"). New routes appear unchecked so they
  //   look like opt-in additions; previously-skipped routes also
  //   appear unchecked. An empty / missing list is treated as "all
  //   imported" — every leaf checked — so a refresh against a
  //   first-import-everything env folder still defaults to keeping
  //   the full surface.
  useEffect(() => {
    const allKeys = allLeafKeys(previewItems)
    const previouslyImported = refreshContext?.alreadyImportedKeys
    if (previouslyImported && previouslyImported.length > 0) {
      const allow = new Set(previouslyImported)
      const initial = new Set<string>()
      for (const key of allKeys) {
        if (allow.has(key)) initial.add(key)
      }
      setSelection(initial)
      return
    }
    setSelection(allKeys)
  }, [previewItems, refreshContext])

  const selectedLeafCount = selection.size

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setInput('')
      setPreviewItems([])
      setSelection(new Set())
      setSearchFilter('')
      setError(null)
      setIsLoading(false)
      setPendingFolders([])
      setShowFolderNameInput(false)
      setNewFolderName('')
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
      >

        {/* Destination Selection — hidden in refresh mode because the
            target env folder is already chosen and immutable. */}
        {!refreshContext && (
        <div className="import-section">
          <label className="import-label">
            {t('import.destination.label')}
          </label>
          <div className="import-destination-row">
            <div data-testid="destination-dropdown-container">
              <ListViewDropdown
                items={folderItems}
                selectedIds={targetFolderId ? [targetFolderId] : ['__root__']}
                expandedIds={expandedFolderIds}
                rootRole="tree"
                menuAriaLabel={t('import.destination.label')}
                align="left"
                data-testid="destination-dropdown"
                buttonContent={
                  <>
                    <i className="codicon codicon-folder" aria-hidden="true" style={{ marginRight: '6px' }} />
                    <span>{selectedFolderName}</span>
                    <i className="codicon codicon-chevron-down" aria-hidden="true" style={{ marginLeft: 'auto', opacity: 0.7 }} />
                  </>
                }
                onItemClick={(payload) => { 
                  setTargetFolderId(payload.item.id === '__root__' ? undefined : payload.item.id) 
                }}
                onItemToggle={(payload, expanded) => {
                  const id = payload.item.id
                  if (expanded) {
                    setExpandedFolderIds(prev => [...prev, id])
                  } else {
                    setExpandedFolderIds(prev => prev.filter(existingId => existingId !== id))
                  }
                }}
                buttonProps={{ 
                  secondary: true,
                  'data-testid': 'destination-dropdown-button'
                }}
              />
            </div>
            <Button
              secondary
              icon="new-folder"
              data-testid="new-folder-button"
              onClick={() => {
                setNewFolderName('')
                setShowFolderNameInput(true)
              }}
            >
              {t('import.destination.newFolder')}
            </Button>
          </div>
        </div>
        )}

        {/* Section 2: Source Input */}
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
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
            >
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
            </div>
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

        {/* Section 3: Selection tree (preview + tri-state checkboxes) */}
        {previewItems.length > 0 && (
          <div className="import-section import-preview-section">
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
                  onClick={() => { setSelection(new Set()) }}
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
                data-testid="import-selection-tree"
              />
            </div>
          </div>
        )}

        {!isLoading && !error && previewItems.length === 0 && input.trim() !== '' && (
          <div className="import-no-results" role="status">
            <i className="codicon codicon-info" aria-hidden="true" />
            {t('import.noResults')}
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
            disabled={previewItems.length === 0 || selectedLeafCount === 0}
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

      {/* Folder Name Input Modal */}
      {showFolderNameInput && (
        <Modal
          isOpen={showFolderNameInput}
          onClose={() => {
            setShowFolderNameInput(false)
            setNewFolderName('')
          }}
          title={t('import.destination.newFolderTitle')}
          data-testid="new-folder-modal"
        >
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', minWidth: '300px' }} data-testid="new-folder-dialog">
            <InputBox
              value={newFolderName}
              onChange={setNewFolderName}
              options={{
                placeholder: t('import.destination.newFolderPlaceholder')
              }}
              data-testid="new-folder-input"
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <Button 
                secondary 
                onClick={() => {
                  setShowFolderNameInput(false)
                  setNewFolderName('')
                }}
                data-testid="new-folder-cancel-button"
              >
                {t('common.cancel')}
              </Button>
              <Button 
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                data-testid="new-folder-ok-button"
              >
                {t('common.ok')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <AuthenticationSetupModal
        isOpen={showAuthSetupModal}
        onClose={() => { setShowAuthSetupModal(false) }}
        onAttach={handleAuthAttach}
        {...(attachedAuth ? { initialRequest: attachedAuth } : {})}
      />
    </Modal>
  )
}
