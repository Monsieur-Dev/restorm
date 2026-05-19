import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tooltip } from 'electron-core-ui/renderer'
import { useOptionalEnvironmentContext } from '../../contexts/useEnvironmentContext'
import {
  clearSessionRequestOverridesForRequests,
  clearStoredRequestOverridesForRequests
} from '../../services/environmentSelectionStore'
import { EnvPopoverList } from '../MainView/EnvSelectorPopover'
import { flattenEnvironments } from '../MainView/envSelectorHelpers'
import './sendButtonEnvSwitcher.css'

export interface SendButtonEnvSwitcherProps {
  /** The Send button itself. Rendered as a child rather than via a
   * factory prop so the call site keeps full control over the Button
   * variant (`emphasis`, `style`, custom icons, etc.) that varies
   * per protocol. */
  children: React.ReactNode
}

/**
 * Wraps a Send button and exposes the shared env-selector popover on
 * right-click — same picker the statusbar uses, anchored below the
 * button with the arrow pointing up. Left-click still goes through to
 * the wrapped Button's own handler unchanged.
 *
 * The wrapper itself only catches `contextmenu` + holds the popover's
 * open state. All env state (list, selection, color, apply-to-all
 * sibling cleanup) is pulled from `useEnvironmentContext` so the
 * popover stays in sync with whatever is showing in the statusbar.
 */
export const SendButtonEnvSwitcher: React.FC<SendButtonEnvSwitcherProps> = ({ children }) => {
  const wrapperRef = useRef<HTMLSpanElement | null>(null)
  const [open, setOpen] = useState(false)
  const [applyToAll, setApplyToAll] = useState(true)
  // The Send button ships in two surfaces: workbench request tabs
  // (wrapped in `<EnvironmentProvider>`) AND `AuthenticationSetupModal`
  // (renders `LocalAuthenticationRequestForm` context-free as a
  // self-contained ephemeral form). The non-throwing variant lets
  // the wrapper render in both places — when there's no provider
  // we just leave the right-click handler inert.
  const ctx = useOptionalEnvironmentContext()
  const environments = ctx?.environments
  const selectedEnvId = ctx?.selectedEnvId ?? null
  const projectUuid = ctx?.projectUuid
  const folderRequestIds = ctx?.folderRequestIds
  const setFolderEnv = ctx?.setFolderEnv
  const setRequestOverride = ctx?.setRequestOverride

  const rows = useMemo(() => (
    environments && environments.length > 0 ? flattenEnvironments(environments) : []
  ), [environments])

  const handleContextMenu = useCallback((event: React.MouseEvent): void => {
    // No envs configured → don't claim the right-click; let the
    // browser's default menu through.
    if (rows.length === 0) return
    event.preventDefault()
    setOpen((prev) => !prev)
  }, [rows.length])

  const handleSelect = useCallback((envId: string): void => {
    if (!setFolderEnv || !setRequestOverride) return
    if (applyToAll) {
      // Same write-order discipline as `StatusbarEnvironmentSelector`:
      // wipe the session-level sibling overrides synchronously BEFORE
      // firing `setFolderEnv`, then schedule the disk cleanup. See the
      // statusbar selector for the full reasoning. When the host
      // didn't expose `folderRequestIds` (e.g. running in in-memory-
      // only mode), the cleanup branch is skipped — `setFolderEnv`
      // still updates the active request, only siblings keep stale
      // overrides until they're switched too.
      if (projectUuid && folderRequestIds && folderRequestIds.length > 0) {
        clearSessionRequestOverridesForRequests(projectUuid, folderRequestIds)
      }
      setFolderEnv(envId)
      if (projectUuid && folderRequestIds && folderRequestIds.length > 0) {
        void clearStoredRequestOverridesForRequests(projectUuid, folderRequestIds)
      }
    } else {
      setRequestOverride(envId)
    }
  }, [applyToAll, projectUuid, folderRequestIds, setFolderEnv, setRequestOverride])

  // Dismiss on outside click + Escape. The Tooltip itself is rendered
  // through a portal so it lives outside the wrapper tree; we
  // therefore guard the "outside" check against the portal node too,
  // by checking if the click landed inside the listbox subtree.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (wrapperRef.current?.contains(target)) return
      const portalListbox = document.querySelector('[data-testid="send-button-env-switcher-listview"]')
      if (portalListbox?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const handleCloseRequested = useCallback((): void => { setOpen(false) }, [])

  return (
    <>
      {/* `inline-flex` + `align-self: stretch` (set in
          `sendButtonEnvSwitcher.css`) so the wrapper participates in
          the surrounding `ControlGroup`'s `align-items: stretch`
          layout exactly like the bare Button it replaces — without
          the CSS chain, the button shrinks to its intrinsic height
          and the URL InputBox next to it looks taller. */}
      <span
        ref={wrapperRef}
        onContextMenu={handleContextMenu}
        className="restorm-send-button-env-switcher"
        data-testid="send-button-env-switcher-anchor"
      >
        {children}
      </span>
      <Tooltip
        targetRef={wrapperRef}
        show={open}
        placement="below"
        content={(
          <EnvPopoverList
            rows={rows}
            selectedEnvId={selectedEnvId}
            applyToAll={applyToAll}
            onApplyToAllChange={setApplyToAll}
            onSelect={handleSelect}
            onCloseRequested={handleCloseRequested}
            testIdPrefix="send-button-env-switcher"
          />
        )}
        data-testid="send-button-env-switcher-tooltip"
      />
    </>
  )
}

export default SendButtonEnvSwitcher
