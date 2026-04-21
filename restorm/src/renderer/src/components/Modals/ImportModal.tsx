/**
 * ImportModal - Modal for importing requests from various sources
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
  Modal,
  Button,
  InputBox,
  ListView,
  type ListViewItemData,
  ListViewDropdown
} from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import type { FolderItem, EnvironmentFolder, Folder } from '../../../../shared/types/collections'
import { isEnvironmentFolder, isRequest } from '../../../../shared/types/collections'
import type { AuthenticationRequest } from '../../../../shared/models'
import { mapToBadgeType } from '../../utils/badgeUtils'
import { logger } from 'electron-core-ui/renderer'
import { AuthenticationSetupModal } from './AuthenticationSetupModal'
import './ImportModal.css'

interface PendingFolder {
  id: string
  name: string
  parentId: string
}

export interface ImportModalProps {
  isOpen: boolean
  onClose: () => void
  onImport: (items: FolderItem[], targetFolderId?: string, pendingFolders?: PendingFolder[]) => void
  rootFolder?: EnvironmentFolder
  selectedFolderId?: string | undefined
}

export function ImportModal({
  isOpen,
  onClose,
  onImport,
  rootFolder,
  selectedFolderId
}: ImportModalProps): React.JSX.Element {
  const { t } = useTranslation()
  
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [previewItems, setPreviewItems] = useState<FolderItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [attachedAuth, setAttachedAuth] = useState<AuthenticationRequest | null>(null)
  const [attachedAuthHeaders, setAttachedAuthHeaders] = useState<Record<string, string> | null>(null)
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
          const previewOptions = attachedAuthHeaders !== null
            ? { extraHeaders: attachedAuthHeaders }
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
  }, [t, attachedAuthHeaders])

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

    // If the user attached an auth request, prepend it to the items and
    // wire every other imported request to reference it. This keeps the
    // whole folder pre-authenticated after the import persists.
    let finalItems: FolderItem[] = previewItems
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
      finalItems = [attachedAuth as unknown as FolderItem, ...attach(previewItems)]
    }

    // Call import with current pending folders
    onImport(finalItems, targetFolderId, pendingFolders)

    // Close modal (useEffect will clear state when modal closes)
    onClose()
  }, [previewItems, targetFolderId, pendingFolders, onImport, onClose, attachedAuth])

  const handleAuthAttach = useCallback((authRequest: AuthenticationRequest, resolvedHeaders: Record<string, string>) => {
    setAttachedAuth(authRequest)
    setAttachedAuthHeaders(resolvedHeaders)
    setShowAuthSetupModal(false)
    // Re-run the preview with the resolved auth headers.
    if (input.trim()) {
      handleInputChange(input)
    }
  }, [input, handleInputChange])

  const handleDetachAuth = useCallback(() => {
    setAttachedAuth(null)
    setAttachedAuthHeaders(null)
    if (input.trim()) {
      handleInputChange(input)
    }
  }, [input, handleInputChange])

  // Build preview ListView items
  const previewListItems: ListViewItemData[] = useMemo(() => {
    if (previewItems.length === 0) return []

    const buildItems = (items: FolderItem[]): ListViewItemData[] => {
      return items.map(item => {
        const isFolder = 'items' in item
        
        if (isFolder) {
          const folder = item
          return {
            id: folder.id,
            title: folder.name,
            icon: 'folder',
            badge: mapToBadgeType('folder'),
            children: folder.items.length > 0 ? buildItems(folder.items) : [],
            expanded: true
          }
        } else {
          const request = item
          const requestType = ('type' in request ? request.type : null) ?? 'http'
          const requestId = 'id' in request ? request.id : crypto.randomUUID()
          const requestName = 'name' in request ? request.name : 'Request'
          return {
            id: requestId,
            title: requestName,
            icon: 'file',
            badge: mapToBadgeType(requestType as string)
          }
        }
      })
    }

    return buildItems(previewItems)
  }, [previewItems])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setInput('')
      setPreviewItems([])
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
      title={t('import.title')}
      data-testid="import-modal-dialog"
    >
      <div className="import-modal" data-testid="import-modal">
        
        {/* Section 1: Destination Selection */}
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

        {/* Section 2: Source Input */}
        <div className="import-section">
          <label className="import-label">
            {t('import.source.label')}
          </label>
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

        {/* Section 3: Preview */}
        {previewItems.length > 0 && (
          <div className="import-section import-preview-section">
            <label className="import-label">
              {t('import.preview.label')}
            </label>
            <div className="import-preview">
              <ListView
                items={previewListItems}
                ariaLabel={t('import.preview.label')}
                onItemClick={() => { /* Preview only */ }}
                onItemContextMenu={() => { /* Preview only */ }}
                data-testid="preview-list"
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
            onClick={handleImportClick}
            disabled={previewItems.length === 0}
            data-testid="import-button"
          >
            {t('import.ok')}
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
