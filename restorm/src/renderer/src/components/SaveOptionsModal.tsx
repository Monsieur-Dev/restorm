/**
 * SaveOptionsModal - Modal for selecting save mode and format
 */

import React, { useState, useCallback } from 'react'
import {
  Modal,
  SelectBox,
  Button,
  type ISelectData
} from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import type { FolderItem, EnvironmentFolder } from '../types/collections'

export type SaveMode = 'file' | 'folder'
export type SaveFormat = 'json' | 'yaml' | 'json5'

export interface SaveOptions {
  mode: SaveMode
  format: SaveFormat
}

interface SaveOptionsModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (options: SaveOptions) => void
  defaultOptions?: Partial<SaveOptions>
  rootFolder?: FolderItem
  title?: string
}

const MODE_OPTIONS: { text: SaveMode; label: string }[] = [
  { text: 'file', label: 'Single File' },
  { text: 'folder', label: 'Folder Structure' }
]

const FORMAT_OPTIONS: { text: SaveFormat; label: string }[] = [
  { text: 'json', label: 'JSON' },
  { text: 'yaml', label: 'YAML' },
  { text: 'json5', label: 'JSON5' }
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
  const [format, setFormat] = useState<SaveFormat>(defaultOptions?.format ?? 'json')

  const modeIndex = MODE_OPTIONS.findIndex(opt => opt.text === mode)
  const formatIndex = FORMAT_OPTIONS.findIndex(opt => opt.text === format)

  const modeOptions = MODE_OPTIONS.map(opt => ({
    text: opt.text,
    label: t(`save.mode.${opt.text}`, opt.label)
  }))

  const handleModeChange = useCallback((data: ISelectData) => {
    const selected = MODE_OPTIONS[data.index]
    if (selected) {
      setMode(selected.text)
    }
  }, [])

  const handleFormatChange = useCallback((data: ISelectData) => {
    const selected = FORMAT_OPTIONS[data.index]
    if (selected) {
      setFormat(selected.text)
    }
  }, [])

  const handleSave = useCallback(() => {
    onSave({ mode, format })
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
      <div className="save-options-modal" data-testid="save-options-modal" style={{ minWidth: '400px', padding: '16px' }}>
        <div className="save-option-group" data-testid="save-mode-group" style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
            {t('save.mode.label', 'Save Mode')}
          </label>
          <SelectBox
            options={modeOptions}
            selected={modeIndex >= 0 ? modeIndex : 0}
            onDidSelect={handleModeChange}
            className="save-mode-select"
            id="save-mode-select"
          />
          <p data-testid="save-mode-description" style={{ marginTop: '4px', fontSize: '12px', opacity: 0.7 }}>
            {mode === 'file'
              ? t('save.mode.fileDescription', 'Save everything in a single file')
              : t('save.mode.folderDescription', 'Save as a folder structure with separate files')}
          </p>
        </div>

        <div className="save-option-group" data-testid="save-format-group" style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
            {t('save.format.label', 'Format')}
          </label>
          <SelectBox
            options={FORMAT_OPTIONS}
            selected={formatIndex >= 0 ? formatIndex : 0}
            onDidSelect={handleFormatChange}
            className="save-format-select"
            id="save-format-select"
          />
        </div>

        {mode === 'folder' && previewLines.length > 0 && (
          <div className="save-option-group" data-testid="save-preview-group" style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
              {t('save.preview.label', 'Structure Preview')}
            </label>
            <div
              data-testid="save-preview-content"
              style={{
                background: 'var(--vscode-editor-background)',
                border: '1px solid var(--vscode-editorWidget-border)',
                borderRadius: '4px',
                padding: '8px',
                maxHeight: '200px',
                overflow: 'auto',
                fontFamily: 'monospace',
                fontSize: '12px'
              }}
            >
              {previewLines.map((line, i) => (
                <div key={i} style={{ whiteSpace: 'pre' }}>{line}</div>
              ))}
            </div>
          </div>
        )}

        <div className="save-options-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
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
