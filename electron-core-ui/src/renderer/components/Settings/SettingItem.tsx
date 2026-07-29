import React, { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../Button'
import { GatedControl } from '../GatedControl'
import { ContextMenu } from '../ContextMenu/ContextMenu'
import type { ContextMenuItem } from '../ContextMenu/ContextMenu'
import { ToggleRenderer } from './renderers/ToggleRenderer'
import { NumberInput } from './renderers/NumberInput'
import { TextInput } from './renderers/TextInput'
import { EnumRenderer } from './renderers/EnumRenderer'
import { ThemeRenderer } from './renderers/ThemeRenderer'
import { getCustomRenderer } from './renderers/registry'
import { useSettings } from '../../hooks/useSettings'
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
  const { capabilityGate } = useSettings()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  // `SettingDefinition.capability` gates via the host's entitlement system
  // (distinct from `feature`, which HIDES the row instead — see that
  // field's own doc). No `capability` tag → never locked. A `capability`
  // tag with no `capabilityGate` wired by the host → also never locked
  // (fails open to "unlocked" rather than silently hiding every
  // capability-tagged setting for a host that hasn't wired the gate yet).
  const capabilityLocked = setting.capability !== undefined && (capabilityGate?.isLocked(setting.capability) ?? false)

  const handleChange = useCallback((v: SettingValue) => {
    onChange(setting.storageKey, v)
  }, [onChange, setting.storageKey])

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
    setting.isModified ? 'setting-item--modified' : ''
  ].filter(Boolean).join(' ')

  // A locked control renders greyed but still SHOWS its stored value, which is
  // wrong whenever the lock exists because the host is overriding that value.
  // `capabilityLockedValue` lets the definition say what is actually in force,
  // so a setting the user cannot change can never display the opposite of what
  // the app is doing — the failure mode that matters most for a privacy toggle.
  const effectiveValue = capabilityLocked && setting.capabilityLockedValue !== undefined
    ? setting.capabilityLockedValue
    : value

  const rendererProps = { setting, value: effectiveValue, onChange: handleChange }

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
      className={classNames}
      data-testid={`setting-item-${setting.storageKey}`}
    >
      {/* The gear stays mounted (revealed by the row's :hover / :focus-within in
          CSS) so it remains a keyboard tab stop — the block container itself is
          NOT focusable, so only the real controls (this gear + the setting's
          input) are tab stops and the row never draws a focus ring. */}
      <Button
        line
        icon="gear"
        className="setting-item-gear"
        options={{ ariaLabel: t('settings.settingOptions', 'Setting options') }}
        data-testid={`setting-gear-${setting.storageKey}`}
        onClick={handleGearClick}
      />
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
          <GatedControl
            locked={capabilityLocked}
            {...(capabilityGate ? { onSubscribe: capabilityGate.onSubscribe } : {})}
            data-testid={`setting-gate-${setting.storageKey}`}
          >
            {control}
          </GatedControl>
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
