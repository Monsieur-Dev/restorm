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
import type { FolderItem, EnvironmentFolder, Folder } from '../types/collections'
import { isEnvironmentFolder } from '../types/collections'
import { mapToBadgeType } from '../utils/badgeUtils'
import './ImportModal.css'

export interface ImportModalProps {
  isOpen: boolean
  onClose: () => void
  onImport: (items: FolderItem[], targetFolderId?: string) => void
  rootFolder?: EnvironmentFolder
  selectedFolderId?: string
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
  const [targetFolderId, setTargetFolderId] = useState<string | undefined>(undefined)
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>(['__root__'])
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
    const buildFolderTree = (items: FolderItem[]): ListViewItemData[] => {
      return items
        .filter(item => 'items' in item) // Only folders (both Folder and EnvironmentFolder)
        .map(item => {
          const folder = item
          const isEnvFolder = isEnvironmentFolder(item)
          
          const folderItem: ListViewItemData = {
            id: folder.id,
            title: folder.name,
            icon: isEnvFolder ? 'folder-library' : 'folder',
            isExpandable: false,
            children: folder.items.length > 0 ? buildFolderTree(folder.items) : []
          }
          return folderItem
        })
    }
    
    // Start by building from root's items (which includes all EnvironmentFolders)
    const rootChildren = buildFolderTree(rootFolder.items)
    
    // Add root option at the top level
    const rootItem: ListViewItemData = {
      id: '__root__',
      title: t('import.destination.root'),
      icon: 'folder-opened',
      children: rootChildren
    }
    
    return [rootItem]
  }, [rootFolder, t])
  
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
    if (!targetFolderId || targetFolderId === '__root__') {
      return t('import.destination.root')
    }
    
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
  }, [targetFolderId, rootFolder, t])

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
      setPreviewItems([])
      setIsLoading(false)
      return
    }

    // Set loading state
    setIsLoading(true)

    // Debounce the preview
    debounceTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const result = await window.restorm?.import.preview(value.trim())
          
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
        handleInputChange(file.path)
      }
    }
  }, [handleInputChange])

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

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

  // Handle import
  const handleImportClick = useCallback(() => {
    if (previewItems.length > 0) {
      // Convert __root__ to undefined
      const actualTargetId = targetFolderId === '__root__' ? undefined : targetFolderId
      onImport(previewItems, actualTargetId)
      // Close modal after a tick to allow state updates to complete
      setTimeout(() => {
        onClose()
      }, 0)
    }
  }, [previewItems, targetFolderId, onImport, onClose])

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
    }
  }, [isOpen])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('import.title')}
    >
      <div className="import-modal" data-testid="import-modal">
        
        {/* Section 1: Destination Selection */}
        <div className="import-section">
          <label className="import-label">
            {t('import.destination.label')}
          </label>
          <div className="import-destination-row">
            <div style={{ width: '100%' }}>
              <ListViewDropdown
                items={folderItems}
                selectedIds={targetFolderId ? [targetFolderId] : ['__root__']}
                expandedIds={expandedFolderIds}
                rootRole="tree"
                menuAriaLabel={t('import.destination.label')}
                align="left"
                minWidth={600}
                buttonContent={
                  <>
                    <i className="codicon codicon-folder" style={{ marginRight: '6px' }} />
                    <span>{selectedFolderName}</span>
                    <i className="codicon codicon-chevron-down" style={{ marginLeft: 'auto', opacity: 0.7 }} />
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
                  secondary: true
                }}
              />
            </div>
            <Button 
              secondary
              onClick={() => {
                // TODO: Implement new folder creation
                // console.log('Create new folder')
              }}
            >
              <i className="codicon codicon-new-folder" />
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
            />
          </div>
          {isLoading && (
            <div className="import-loading">
              <i className="codicon codicon-loading codicon-modifier-spin" />
              {t('import.loading')}
            </div>
          )}
          {error && (
            <div className="import-error">
              <i className="codicon codicon-error" />
              {error}
            </div>
          )}
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
                onItemClick={() => { /* Preview only */ }}
                onItemContextMenu={() => { /* Preview only */ }}
              />
            </div>
          </div>
        )}

        {!isLoading && !error && previewItems.length === 0 && input.trim() !== '' && (
          <div className="import-no-results">
            <i className="codicon codicon-info" />
            {t('import.noResults')}
          </div>
        )}

        {/* Actions */}
        <div className="import-actions">
          <Button secondary onClick={onClose}>
            {t('import.cancel')}
          </Button>
          <Button 
            onClick={handleImportClick}
            disabled={previewItems.length === 0}
          >
            {t('import.ok')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
