/**
 * Quick-settings button for the request smartbar.
 *
 * Renders a small icon button that opens an ECUI Tooltip-based popover
 * (matching the RequestHeaderEnvSelector pattern — there is no ECUI Popover
 * primitive; we use Tooltip with manual open state). Inside:
 *   - A name input pre-filled when the current config matches a saved one.
 *   - A storage-target Toggle (user settings vs .restorm project file).
 *   - A Save button.
 *   - A merged list of all saved configs with per-row origin badges and
 *     a trash button each.
 *
 * Loading a config shows a confirmation Modal before applying.
 * Deleting a config shows a confirmation Modal before removing.
 *
 * After applying a config the component calls
 * window.restorm.context.updateFullRequestData to re-trigger Handlebars
 * resolution in the main process (AC#8).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, eventBus, InputBox, Modal, Toggle, Tooltip } from 'electron-core-ui/renderer'
import type { Request } from '../../../../shared/types/collections'
import type { QuickConfig, QuickConfigStorageTarget } from '../../../../shared/types/requests/QuickConfig'
import {
  applyConfigToRequest,
  deleteProjectConfig,
  deleteSettingsConfig,
  extractSnapshotFields,
  findMatchingConfig,
  getAllConfigs,
  saveProjectConfig,
  saveSettingsConfig
} from '../../services/requestQuickConfigStore'
import { DocumentEvents } from '../../services/DocumentEvents'
import { HeaderHoverTooltip } from './HeaderHoverTooltip'

export interface RequestQuickSettingsButtonProps {
  /** The reactive request proxy for this tab. */
  request: Request
  /** Project UUID — scopes the user-settings backend key. */
  projectUuid: string | null | undefined
}

// ============================================================================
// Confirmation modal sub-component
// ============================================================================

interface ConfirmModalState {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
}

const CONFIRM_MODAL_INITIAL: ConfirmModalState = {
  open: false,
  title: '',
  message: '',
  onConfirm: () => undefined
}

// ============================================================================
// Config row sub-component
// ============================================================================

interface ConfigRowProps {
  config: QuickConfig
  onLoad: (config: QuickConfig) => void
  onDelete: (config: QuickConfig) => void
  projectBadgeLabel: string
  settingsBadgeLabel: string
}

const ConfigRow: React.FC<ConfigRowProps> = ({ config, onLoad, onDelete, projectBadgeLabel, settingsBadgeLabel }) => {
  const badgeLabel = config.storageTarget === 'project' ? projectBadgeLabel : settingsBadgeLabel
  return (
    <div
      className="quick-settings-config-row"
      style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}
    >
      <Button
        fullWidth
        secondary
        small
        line
        align="left"
        style={{ paddingLeft: 8, paddingRight: 4, flex: 1, minWidth: 0, overflow: 'hidden' }}
        data-testid={`quick-settings-load-${config.id}`}
        onClick={() => { onLoad(config) }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {config.name}
          </span>
          <span
            className={`quick-settings-badge quick-settings-badge--${config.storageTarget}`}
            style={{
              fontSize: '0.7em',
              padding: '1px 4px',
              borderRadius: 3,
              flexShrink: 0,
              opacity: 0.75
            }}
          >
            {badgeLabel}
          </span>
        </span>
      </Button>
      <Button
        secondary
        small
        line
        icon="trash"
        style={{ flexShrink: 0, padding: '0 4px' }}
        data-testid={`quick-settings-delete-${config.id}`}
        onClick={() => { onDelete(config) }}
      />
    </div>
  )
}

// ============================================================================
// Main component
// ============================================================================

export const RequestQuickSettingsButton: React.FC<RequestQuickSettingsButtonProps> = ({
  request,
  projectUuid
}) => {
  const { t } = useTranslation()
  const anchorRef = useRef<HTMLSpanElement>(null)
  // Ref to the underlying <input> DOM element so handleSave can read the live
  // value synchronously — bypasses the ECUI InputBox's setTimeout(fn, 0)
  // debounce which would make configName state stale at click time.
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)

  // Storage target: 'settings' (user-local) or 'project' (.restorm file)
  const [storageTarget, setStorageTarget] = useState<QuickConfigStorageTarget>('settings')

  // Config name input (state drives the controlled InputBox value)
  const [configName, setConfigName] = useState('')

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>(CONFIRM_MODAL_INITIAL)

  // Re-render on request mutations: subscribe to REQUEST_UPDATED so the
  // merged config list and the matching-name pre-fill stay live. The
  // reactive proxy emits this event (local + main) on every field change.
  // `tick` is passed as a dependency to the memos below so they recompute
  // after in-place proxy mutations (which don't change object references).
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = (): void => { setTick((n) => n + 1) }
    const subs = [
      eventBus.subscribe(DocumentEvents.REQUEST_UPDATED, bump),
      eventBus.subscribe(DocumentEvents.REQUEST_CREATED, bump),
      eventBus.subscribe(DocumentEvents.REQUEST_DELETED, bump)
    ]
    return () => { subs.forEach((s) => { s.unsubscribe() }) }
  }, [])

  // Dismiss popover on outside click
  useEffect(() => {
    if (!open) return undefined
    const onDocMouseDown = (e: MouseEvent): void => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as globalThis.Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => { document.removeEventListener('mousedown', onDocMouseDown) }
  }, [open])

  // Merged config list from both backends. `tick` is read inside the callback
  // to bust the cache when the reactive proxy fires REQUEST_UPDATED — the proxy
  // mutates in-place so object identity never changes; we need an explicit
  // dependency to force recomputation after mutations.
  const allConfigs = useMemo(
    () => { void tick; return getAllConfigs(request, projectUuid ?? '') },
    [request, projectUuid, tick]
  )

  // Current snapshot of the request fields. `tick` busts the cache when
  // REQUEST_UPDATED fires so the snapshot reflects the live proxy state.
  const currentFields = useMemo(
    () => { void tick; return extractSnapshotFields(request) },
    [request, tick]
  )

  // Pre-fill name when the current config matches a saved one
  const matchingConfig = useMemo(
    () => findMatchingConfig(allConfigs, currentFields),
    [allConfigs, currentFields]
  )

  // matchingName is passed to the button's onClick to pre-fill on open.
  const matchingName = matchingConfig?.name ?? ''

  // Save current config. Reads the live DOM value from nameInputRef as the
  // authoritative name — the ECUI InputBox fires onChange via setTimeout(fn, 0)
  // even with changeDebounceMs={0}, so configName state may be one render
  // behind at click time. The ref gives the value the user actually typed.
  const handleSave = useCallback((): void => {
    const liveValue = nameInputRef.current?.value ?? configName
    const trimmed = liveValue.trim()
    if (!trimmed) return

    if (storageTarget === 'settings' && projectUuid) {
      saveSettingsConfig(projectUuid, request.id, trimmed, currentFields)
      // Settings saves don't emit REQUEST_UPDATED (no reactive proxy involved),
      // so manually bump tick to force allConfigs to re-read the updated cache.
      setTick((n) => n + 1)
    } else if (storageTarget === 'project') {
      saveProjectConfig(request, trimmed, currentFields)
      // Project saves mutate the reactive proxy which emits REQUEST_UPDATED →
      // tick bumps automatically via the eventBus subscription above.
    }
    // Update state to match what was actually saved so the input stays in sync.
    setConfigName(trimmed)
    // Keep the popover open so the user sees the updated list immediately.
  }, [configName, storageTarget, projectUuid, request, currentFields])

  // Load config: prompt confirmation first
  const handleLoadRequest = useCallback((config: QuickConfig): void => {
    setConfirmModal({
      open: true,
      title: t('quickSettings.loadConfirm.title'),
      message: t('quickSettings.loadConfirm.message', { name: config.name }),
      onConfirm: () => {
        setConfirmModal(CONFIRM_MODAL_INITIAL)
        // Mutate the reactive proxy: each field assignment goes through the
        // proxy's set-trap, emitting a debounced REQUEST_UPDATED. The tab
        // view's own useEffect hooks subscribe to REQUEST_UPDATED and call
        // window.restorm.context.updateFullRequestData with the refreshed
        // values — this is the canonical path for Handlebars re-resolution
        // (AC#8) and keeps the component free of protocol-specific field
        // serialisation (FullRequestData shape vs KeyValue vs KeyValueData).
        applyConfigToRequest(request, config)
        setOpen(false)
      }
    })
  }, [t, request])

  // Delete config: prompt confirmation first
  const handleDeleteRequest = useCallback((config: QuickConfig): void => {
    setConfirmModal({
      open: true,
      title: t('quickSettings.deleteConfirm.title'),
      message: t('quickSettings.deleteConfirm.message', { name: config.name }),
      onConfirm: () => {
        setConfirmModal(CONFIRM_MODAL_INITIAL)
        if (config.storageTarget === 'settings' && projectUuid) {
          deleteSettingsConfig(projectUuid, request.id, config.id)
          // Bump tick: settings deletes don't emit REQUEST_UPDATED.
          setTick((n) => n + 1)
        } else {
          deleteProjectConfig(request, config.id)
          // Project deletes mutate the reactive proxy → REQUEST_UPDATED → tick bumps automatically.
        }
      }
    })
  }, [t, projectUuid, request])

  const handleKeyDownOnName = useCallback((e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      handleSave()
    }
  }, [handleSave])

  const projectBadgeLabel = t('quickSettings.badge.project')
  const settingsBadgeLabel = t('quickSettings.badge.settings')

  return (
    <>
      <span
        ref={anchorRef}
        className="request-quick-settings-button"
        onMouseDown={(e) => { e.stopPropagation() }}
        style={{ display: 'inline-flex' }}
      >
        <HeaderHoverTooltip
          label={t('quickSettings.button.tooltip')}
          suppressed={open}
          placement="below"
          data-testid="quick-settings-tooltip"
        >
          <Button
            secondary
            small
            line
            icon="list-ordered"
            data-testid="quick-settings-open-button"
            onClick={() => {
              if (!open) {
                // Pre-fill the name input when opening: use the matching config
                // name if the current config equals a saved one, or clear.
                setConfigName(matchingName)
              }
              setOpen((v) => !v)
            }}
          />
        </HeaderHoverTooltip>
        {/* The popover itself, anchored to the outer span */}
        <Tooltip
          targetRef={anchorRef}
          show={open}
          placement="below"
          data-testid="quick-settings-popover"
          content={
            <div
              className="quick-settings-popover"
              onMouseDown={(e) => { e.stopPropagation() }}
              style={{ minWidth: 280, maxWidth: 380, padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}
            >
                {/* Name input + save button */}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <InputBox
                      options={{
                        placeholder: t('quickSettings.namePlaceholder'),
                        ariaLabel: t('quickSettings.namePlaceholder')
                      }}
                      value={configName}
                      onChange={setConfigName}
                      changeDebounceMs={0}
                      inputRef={nameInputRef}
                      onKeyDown={handleKeyDownOnName}
                      data-testid="quick-settings-name-input"
                    />
                  </div>
                  <HeaderHoverTooltip
                    label={t('quickSettings.saveButton')}
                    placement="below"
                  >
                    <Button
                      small
                      icon="check"
                      options={{ ariaLabel: t('quickSettings.saveButton') }}
                      disabled={configName.trim().length === 0}
                      data-testid="quick-settings-save-button"
                      onClick={handleSave}
                    />
                  </HeaderHoverTooltip>
                </div>

                {/* Storage target toggle. The label is passed as the Toggle's
                    children so the whole row (switch + text) is clickable. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Toggle
                    appearance="switch"
                    checked={storageTarget === 'project'}
                    onChange={(checked: boolean) => { setStorageTarget(checked ? 'project' : 'settings') }}
                    aria-label={t('quickSettings.storageTarget.label')}
                    data-testid="quick-settings-storage-toggle"
                  >
                    <span style={{ fontSize: '0.85em', lineHeight: 1.3 }}>
                      {t('quickSettings.storageTarget.label')}
                    </span>
                  </Toggle>
                </div>

                {/* Config list */}
                {allConfigs.length > 0 && (
                  <div
                    className="quick-settings-config-list"
                    style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                    role="listbox"
                    aria-label={t('quickSettings.listLabel')}
                  >
                    {allConfigs.map((config) => (
                      <ConfigRow
                        key={`${config.storageTarget}:${config.id}`}
                        config={config}
                        onLoad={handleLoadRequest}
                        onDelete={handleDeleteRequest}
                        projectBadgeLabel={projectBadgeLabel}
                        settingsBadgeLabel={settingsBadgeLabel}
                      />
                    ))}
                  </div>
                )}

                {allConfigs.length === 0 && (
                  <p style={{ margin: 0, fontSize: '0.85em', opacity: 0.6 }}>
                    {t('quickSettings.emptyList')}
                  </p>
                )}
              </div>
            }
          />
      </span>

      {/* Confirmation modal (load or delete) */}
      <Modal
        title={confirmModal.title}
        isOpen={confirmModal.open}
        onClose={() => { setConfirmModal(CONFIRM_MODAL_INITIAL) }}
        size="dialog"
        data-testid="quick-settings-confirm-modal"
      >
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p style={{ margin: 0 }}>{confirmModal.message}</p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button
              secondary
              data-testid="quick-settings-confirm-cancel"
              onClick={() => { setConfirmModal(CONFIRM_MODAL_INITIAL) }}
            >
              {t('quickSettings.confirm.cancel')}
            </Button>
            <Button
              data-testid="quick-settings-confirm-ok"
              onClick={confirmModal.onConfirm}
            >
              {t('quickSettings.confirm.ok')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

export default RequestQuickSettingsButton
