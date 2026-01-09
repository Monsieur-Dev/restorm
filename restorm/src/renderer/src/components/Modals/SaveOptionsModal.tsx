/**
 * SaveOptionsModal - Modal for selecting save mode and format
 */

import React, { useState, useCallback } from 'react'
import {
  Modal,
  Button,
  type PersistenceFormat
} from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import type { FolderItem, EnvironmentFolder } from '../../types/collections'
import './SaveOptionsModal.css'

export type SaveMode = 'file' | 'folder'
export type SaveFormat = PersistenceFormat

export interface SaveOptions {
  mode: SaveMode
  format: SaveFormat
}

interface SaveOptionsModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (options: SaveOptions) => void | Promise<void>
  defaultOptions?: Partial<SaveOptions>
  rootFolder?: FolderItem
  title?: string
}

const MODE_OPTIONS: { value: SaveMode; label: string; icon: string; description: string }[] = [
  { value: 'file', label: 'Single File', icon: 'file', description: 'All data in one file' },
  { value: 'folder', label: 'Folder', icon: 'folder-opened', description: 'Organized structure' }
]

const FORMAT_OPTIONS: { value: SaveFormat; label: string; description: string }[] = [
  { value: 'yaml', label: 'YAML', description: 'Human readable' },
  { value: 'json', label: 'JSON', description: 'Standard format' },
  { value: 'json5', label: 'JSON5', description: 'JSON + comments' }
]

export function SaveOptionsModal({
  isOpen,
  onClose,
  onSave,
  defaultOptions,
  rootFolder,
  title
}: SaveOptionsModalProps): React.JSX.Element {
  const { t } = useTranslation()

  const [mode, setMode] = useState<SaveMode>(defaultOptions?.mode ?? 'file')
  const [format, setFormat] = useState<SaveFormat>(defaultOptions?.format ?? 'yaml')

  const handleModeChange = useCallback((index: number) => {
    const selected = MODE_OPTIONS[index]
    if (selected) {
      setMode(selected.value)
    }
  }, [])

  const handleFormatChange = useCallback((value: SaveFormat) => {
    setFormat(value)
  }, [])

  const handleSave = useCallback(() => {
    void onSave({ mode, format })
    onClose()
  }, [mode, format, onSave, onClose])

  const generatePreview = useCallback((): string[] => {
    if (mode !== 'folder' || !rootFolder) return []

    const preview: string[] = []
    const generateStructure = (item: FolderItem, depth: number, index: number): void => {
      const indent = '  '.repeat(depth)
      const prefix = depth === 0 ? '' : `${String(index + 1).padStart(2, '0')} - `

      if ('items' in item) {
        const folderName = `${prefix}${item.name}/`
        preview.push(`${indent}${folderName}`)

        const envFolder = item as EnvironmentFolder
        if ('environments' in envFolder && envFolder.environments.length > 0) {
          preview.push(`${indent}  environments/`)
          envFolder.environments.forEach((env, i) => {
            preview.push(`${indent}    ${String(i + 1).padStart(2, '0')} - ${env.name}.${format}`)
          })
        }

        item.items.forEach((child, i) => {
          generateStructure(child, depth + 1, i)
        })
      } else {
        const type = item.type.toUpperCase()
        const name = 'method' in item ? item.method : type
        preview.push(`${indent}${prefix}${name} - ${item.name}.${format}`)
      }
    }

    generateStructure(rootFolder, 0, 0)
    return preview
  }, [mode, rootFolder, format])

  const previewLines = generatePreview()

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title ?? t('save.title', 'Save Options')}
    >
      <div className="save-options-modal" data-testid="save-options-modal">
        <div className="save-option-group" data-testid="save-mode-group">
          <label className="save-option-label">
            {t('save.mode.label', 'Save Mode')}
          </label>
          <div className="save-mode-buttons">
            {MODE_OPTIONS.map((opt, idx) => (
              <Button
                key={opt.value}
                icon={opt.icon}
                secondary
                className={`save-mode-button ${mode === opt.value ? 'active' : ''}`}
                onClick={() => { handleModeChange(idx) }}
                data-testid={`save-mode-${opt.value}`}
              >
                <span className="save-mode-button-label">
                  {t(`save.mode.${opt.value}`, opt.label)}
                </span>
                <span className="save-mode-button-description">
                  {t(`save.mode.${opt.value}Description`, opt.description)}
                </span>
              </Button>
            ))}
          </div>
          <p data-testid="save-mode-description" className="save-option-description">
            {mode === 'file'
              ? t('save.mode.fileDescription', 'Save everything in a single file')
              : t('save.mode.folderDescription', 'Save as a folder structure with separate files')}
          </p>
        </div>

        <div className="save-option-group" data-testid="save-format-group">
          <label className="save-option-label">
            {t('save.format.label', 'Format')}
          </label>
          <div className="save-format-buttons">
            {FORMAT_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                secondary
                className={`save-format-button ${format === opt.value ? 'active' : ''}`}
                onClick={() => { handleFormatChange(opt.value) }}
                data-testid={`save-format-${opt.value}`}
              >
                <span className="save-format-button-label">{opt.label}</span>
                <span className="save-format-button-description">
                  {t(`save.format.${opt.value}Description`, opt.description)}
                </span>
              </Button>
            ))}
          </div>
        </div>

        {mode === 'folder' && previewLines.length > 0 && (
          <div className="save-option-group" data-testid="save-preview-group">
            <label className="save-option-label">
              {t('save.preview.label', 'Structure Preview')}
            </label>
            <div className="save-preview-content" data-testid="save-preview-content">
              {previewLines.map((line, i) => (
                <div key={i} style={{ whiteSpace: 'pre' }}>{line}</div>
              ))}
            </div>
          </div>
        )}

        <div className="save-options-actions">
          <Button onClick={onClose} secondary data-testid="save-cancel-button">
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleSave} data-testid="save-confirm-button">
            {t('common.save', 'Save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
