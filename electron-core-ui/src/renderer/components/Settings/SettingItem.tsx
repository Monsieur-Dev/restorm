import React, { useState, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../Button'
import { ContextMenu } from '../ContextMenu/ContextMenu'
import type { ContextMenuItem } from '../ContextMenu/ContextMenu'
import { ToggleRenderer } from './renderers/ToggleRenderer'
import { NumberInput } from './renderers/NumberInput'
import { TextInput } from './renderers/TextInput'
import { EnumRenderer } from './renderers/EnumRenderer'
import { ThemeRenderer } from './renderers/ThemeRenderer'
import { getCustomRenderer } from './renderers/registry'
import logger from '../../services/logger'
import type { ResolvedSetting, SettingValue } from '../../../types/settings'

export interface SettingItemProps {
  setting: ResolvedSetting
  value: SettingValue
  onChange: (storageKey: string, value: SettingValue) => void
  onReset: (storageKey: string) => void
}

export const SettingItem: React.FC<SettingItemProps> = ({
  setting,
  value,
  onChange,
  onReset
}) => {
  const { t } = useTranslation()
  const [isFocused, setIsFocused] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleChange = useCallback((v: SettingValue) => {
    onChange(setting.storageKey, v)
  }, [onChange, setting.storageKey])

  const handleClick = useCallback(() => {
    setIsFocused(true)
  }, [])

  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.relatedTarget)) {
      setIsFocused(false)
    }
  }, [])

  const handleGearClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setContextMenu({ x: rect.left, y: rect.bottom })
  }, [])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => [
    {
      id: 'reset',
      label: t('settings.resetSetting', 'Reset Setting'),
      onClick: () => {
        onReset(setting.storageKey)
        setContextMenu(null)
      }
    },
    {
      id: 'copy-id',
      label: t('settings.copySettingId', 'Copy Setting ID'),
      onClick: () => {
        void navigator.clipboard.writeText(setting.storageKey)
        setContextMenu(null)
      }
    }
  ], [t, onReset, setting.storageKey])

  const classNames = [
    'setting-item',
    setting.isModified ? 'setting-item--modified' : '',
    isFocused ? 'setting-item--focused' : ''
  ].filter(Boolean).join(' ')

  const rendererProps = { setting, value, onChange: handleChange }

  const renderControl = (): React.ReactNode => {
    switch (setting.type) {
      case 'toggle':
        return <ToggleRenderer {...rendererProps} />
      case 'number':
        return <NumberInput {...rendererProps} />
      case 'text':
        return <TextInput {...rendererProps} />
      case 'enum':
        return <EnumRenderer {...rendererProps} />
      case 'theme':
        return <ThemeRenderer {...rendererProps} />
      default: {
        const CustomRenderer = getCustomRenderer(setting.type)
        if (CustomRenderer) {
          return <CustomRenderer {...rendererProps} />
        }
        logger.error(`[SettingItem] No renderer registered for type "${setting.type}" (setting: ${setting.storageKey}). Use registerSettingRenderer() to register a custom renderer.`)
        return null
      }
    }
  }

  const control = renderControl()

  return (
    <div
      ref={containerRef}
      className={classNames}
      onClick={handleClick}
      onBlur={handleBlur}
      tabIndex={0}
      data-testid={`setting-item-${setting.storageKey}`}
    >
      {isFocused && (
        <Button
          line
          icon="gear"
          className="setting-item-gear"
          options={{ ariaLabel: t('settings.settingOptions', 'Setting options') }}
          data-testid={`setting-gear-${setting.storageKey}`}
          onClick={handleGearClick}
        />
      )}
      <div className="setting-item-header">
        <span className="setting-item-title">
          {t(setting.titleKey)}
        </span>
      </div>
      {setting.descriptionKey && setting.type !== 'toggle' && (
        <span className="setting-item-description">
          {t(setting.descriptionKey)}
        </span>
      )}
      {control && (
        <div className="setting-item-control">
          {control}
        </div>
      )}
      {contextMenu && (
        <ContextMenu
          visible
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onRequestClose={handleCloseContextMenu}
        />
      )}
    </div>
  )
}
