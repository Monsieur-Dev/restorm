import React, { useCallback, useState } from 'react'
import { docsUrl } from '../../../../../shared/config/site'
import { resolveChannel } from '../../../../../shared/config/backend'
import type { SidebarContextMenuItem } from '../Sidebar/contextMenuBuilder'
import { useTranslation } from 'react-i18next'
import {
  Titlebar,
  MenuBar,
  MenuBarItem,
  MenuItem,
  MenuItemSeparator,
  Button,
  AccountButton,
  eventBus,
  useSettingsModal,
  useFeature,
  useElectronPlatform,
  LIST_VIEW_DRAG_MIME,
  type SearchResult
} from 'electron-core-ui/renderer'
import { renderSearchTooltipContent } from './renderSearchTooltipContent'
import { RELEASE_NOTES_OPEN, type ReleaseNotesOpenPayload } from '../../releaseNotesEvents'
import { DASHBOARD_URL } from '../../../../../shared/config/site'
import { HeaderHoverTooltip } from '../HeaderHoverTooltip'
import { AboutModal } from '../../Modals/AboutModal'
import { CliTokensModal } from '../../Modals/CliTokensModal'
import { CookieManagerModal } from '../../Modals/CookieManagerModal'
import { Badge } from '../../common/Badge'
import { mapToBadgeType } from '../../../utils/badgeUtils'
import { useMcpEnabled } from '../../../hooks/useMcpEnabled'
import { useGitGateState } from '../../../hooks/useGitGateState'
import { useUpdateState } from '../../../hooks/useUpdateState'

/** Categories whose search results render with the single-line badge
 * layout (method/protocol pill + title + breadcrumb on one row). The
 * default in ECUI is `['request']`; restorm also wants scenarios in
 * there so the SCENARIO badge sits next to the title instead of an
 * icon + two-line stacked breadcrumb. */
const SEARCH_BADGED_CATEGORIES = ['request', 'scenario']

/**
 * Drag payload for a search result, so dropping a result onto a scenario or the
 * workbench behaves exactly like dragging the matching sidebar row. Stamps the
 * same `dataTransfer` shape the tree's `ListView` uses (`text/plain` +
 * `LIST_VIEW_DRAG_MIME`, both the item id) — the drop targets already read that.
 * Returns undefined for results that don't map to a draggable tree item.
 */
function searchResultDragData(result: SearchResult): Record<string, string> | undefined {
  const nav = result.navigation
  const id =
    nav?.['type'] === 'request' ? nav['requestId'] :
    nav?.['type'] === 'folder' ? nav['folderId'] :
    nav?.['type'] === 'scenario' ? nav['scenarioId'] :
    undefined
  if (typeof id !== 'string' || id.length === 0) return undefined
  return { 'text/plain': id, [LIST_VIEW_DRAG_MIME]: id }
}

export interface RestormTitlebarProps {
  fileName: string | null
  isDirty: boolean
  recentFiles: { path: string; name: string }[]
  favorites: { path: string; name: string }[]
  onNew: () => void
  onOpen: () => void
  onSave: () => unknown
  onSaveAll: () => unknown
  onSaveAs: () => void
  onClose: () => void
  onExit: () => void
  onImport: () => void
  onOpenRecentFile: (path: string) => void
  onSearchResultClick: (result: SearchResult) => void
  /** Open / focus the firewall + outgoing-request console workbench
   * tab. Wired to the `View → Console` menu item; the host owns the
   * focus-or-create logic so the singleton-tab + bottom-group
   * placement decisions stay close to the workbench tree. */
  onOpenConsole: () => void
  /** Open / focus the Firewall admin singleton tab. Wired to the
   * `View → Firewall` menu item. Same singleton-or-focus pattern
   * as Console, but no specific placement constraint — the host
   * just appends to the focused group. */
  onOpenFirewall: () => void
  /** Open / focus the Mini browser singleton tab. Wired to
   * `View → Mini browser`. Same singleton-or-focus pattern as
   * Firewall. */
  onOpenMiniBrowser: () => void
  /** Open the MCP call-logs viewer (tab when a file is open, modal
   * otherwise). Wired to `View → MCP logs`; the entry is disabled when
   * the embedded MCP server isn't running. */
  onOpenMcpLogs: () => void
  /** Repo-push, same effect + codicon as the statusbar `GIT` entry's push
   * button. Wired to `Git → Push`. */
  onGitPush: () => void
  /** Manual both-sides git refresh (mirrors the statusbar refresh icon). */
  onGitRefresh: () => void
  /** Opens the git-history modal (mirrors the statusbar source-control icon). */
  onGitHistory: () => void
  /** Discard every local change and take the server's version. */
  onGitResetToServer: () => void
  /** Pastille flags, same derivation as the statusbar (useGitPendingFlags). */
  gitPushPending: boolean
  gitPullPending: boolean
  /** Repo-pull, same effect + codicon as the statusbar `GIT` entry's pull
   * button. Wired to `Git → Pull`. */
  onGitPull: () => void
  /** Whether a workbench (an open file) is currently active. When
   * true, the gear button and `View → Settings` open Settings as a
   * singleton workbench tab; when false they fall back to the
   * full-screen Settings modal. */
  workbenchActive: boolean
  /** Open / focus the Settings singleton tab. Used only when
   * `workbenchActive` is true; otherwise the modal is shown. */
  onOpenSettingsTab: () => void
  /** The sidebar selection the Édition / Sélection menus act on. */
  selection?: { id: string; kind: 'env-folder' | 'folder' | 'scenario' | 'server' | 'request'; isFavorite: boolean } | null
  /** Whether a paste payload is staged (enables Coller). */
  canPaste?: boolean
  onCutSelection?: () => void
  onCopySelection?: () => void
  onPasteSelection?: () => void
  onCloneSelection?: () => void
  onDeleteSelection?: () => void
  onToggleFavoriteSelection?: () => void
  onFocusSearch?: () => void
  /** The add entries of the « Créer » menu — built by the host from the
   * SAME catalogue as the sidebar context menu's « Ajouter », placement
   * rules included (container → inside at the end; request → sibling
   * after; no selection → root). */
  selectionAddSubmenu?: SidebarContextMenuItem[] | null
  /** Run/cancel handlers for the ACTIVE workbench tab's CLIENT request —
   * the « Requête » menu shows only when this is non-null. */
  activeRequestControls?: { onRun: () => void; onCancel: () => void } | null
  /** Action entries mirroring the ACTIVE server editor tab's buttons —
   * the « Serveur » menu shows only when this is non-null. */
  activeServerMenu?: SidebarContextMenuItem[] | null
  /** Add-node palette of the ACTIVE scenario tab (the same items as the
   * right-click on its empty canvas) — the « Scénario » menu shows only
   * when this is non-null. */
  activeScenarioPalette?: SidebarContextMenuItem[] | null
}

/**
 * Main application titlebar with menu and search
 */
export const RestormTitlebar: React.FC<RestormTitlebarProps> = ({
  fileName,
  isDirty,
  recentFiles,
  favorites,
  onNew,
  onOpen,
  onSave,
  onSaveAll,
  onSaveAs,
  onClose,
  onExit,
  onImport,
  onOpenRecentFile,
  onSearchResultClick,
  onOpenConsole,
  onOpenFirewall,
  onOpenMiniBrowser,
  onOpenMcpLogs,
  onGitPush,
  onGitPull,
  onGitRefresh,
  onGitHistory,
  onGitResetToServer,
  gitPushPending,
  gitPullPending,
  workbenchActive,
  onOpenSettingsTab,
  selection = null,
  canPaste = false,
  onCutSelection,
  onCopySelection,
  onPasteSelection,
  onCloneSelection,
  onDeleteSelection,
  onToggleFavoriteSelection,
  onFocusSearch,
  selectionAddSubmenu = null,
  activeRequestControls = null,
  activeServerMenu = null,
  activeScenarioPalette = null
}) => {
  const { t, i18n } = useTranslation()
  // macOS renders the menus natively (system bar) — the Édition menu must
  // carry the platform text-editing roles there, see the block below.
  const isMac = useElectronPlatform() === 'darwin'
  const { showSettingsModal } = useSettingsModal()
  const { isEnabled: navigationEnabled } = useFeature('navigation')
  // The MCP-logs menu entry is disabled when the embedded MCP server isn't
  // running — there'd be nothing to view.
  const mcpEnabled = useMcpEnabled()
  // The Git menu's root + both sub-items are disabled whenever the
  // 3-state gate says locked (Community OR Pro-without-a-git-folder); the
  // "Pro" badge next to the root label is Community-specific — a Pro user
  // without a git folder has nothing to buy, so no badge for them.
  const gitGate = useGitGateState()
  // "Check for updates" (Help menu) is shown only for a direct-download build
  // that self-manages updates — hidden for store / package-manager builds where
  // the store owns updates. `checkNow` reuses the same flow as the Settings
  // button; feedback is the shared update toasts.
  const { settings: updateSettings, checkNow: checkForUpdates } = useUpdateState()

  // Settings opens as a workbench tab when a file is open, or as the
  // full-screen modal on the welcome screen (no workbench).
  const handleOpenSettings = useCallback(() => {
    if (workbenchActive) {
      onOpenSettingsTab()
    } else {
      showSettingsModal()
    }
  }, [workbenchActive, onOpenSettingsTab, showSettingsModal])

  const handleMenuNew = useCallback(() => {
    onNew()
  }, [onNew])

  const handleMenuOpen = useCallback(() => {
    onOpen()
  }, [onOpen])

  const handleMenuSave = useCallback(() => {
    onSave()
  }, [onSave])

  const handleMenuSaveAll = useCallback(() => {
    onSaveAll()
  }, [onSaveAll])

  const handleMenuSaveAs = useCallback(() => {
    onSaveAs()
  }, [onSaveAs])

  const handleMenuClose = useCallback(() => {
    onClose()
  }, [onClose])

  const handleMenuExit = useCallback(() => {
    onExit()
  }, [onExit])

  const handleImport = useCallback(() => {
    onImport()
  }, [onImport])

  // Toggle fullscreen over IPC on every platform. On macOS the native menu
  // deliberately does NOT map this onto Electron's `togglefullscreen` role:
  // AppKit would then inject its own "Enter Full Screen" item and the menu
  // would show two. Driving the window over IPC keeps a single entry.
  const handleToggleFullscreen = useCallback(() => {
    void window.api.toggleFullscreen()
  }, [])

  // The About dialog is owned here: it is opened from this menu alone and has
  // no state to share with the rest of the app.
  const [aboutOpen, setAboutOpen] = useState(false)
  const [cliTokensOpen, setCliTokensOpen] = useState(false)
  const [cookieManagerOpen, setCookieManagerOpen] = useState(false)
  const handleCloseAbout = useCallback(() => { setAboutOpen(false) }, [])

  // Render a sidebar context-menu data structure as MenuBar items — the
  // Sélection « Ajouter » submenu and the Scénario menu reuse the exact
  // builders their surfaces use, so the two stay identical by construction.
  const renderMenuData = useCallback(function renderData(items: SidebarContextMenuItem[], prefix: string): React.ReactNode {
    return (
    items.map((item, i) => {
      if (item.isSeparator) return <MenuItemSeparator key={`${prefix}-sep-${String(i)}`} data-testid={`${prefix}-sep-${String(i)}`} />
      return (
        <MenuItem
          key={`${prefix}-${item.id}`}
          data-testid={`${prefix}-${item.id}`}
          title={item.label}
          {...(typeof item.icon === 'string' && item.icon.length > 0 ? { icon: <span className={`codicon codicon-${item.icon}`} aria-hidden="true" /> } : item.icon !== undefined && typeof item.icon !== 'string' ? { icon: item.icon } : {})}
          {...(item.onClick ? { onClick: item.onClick } : {})}
          {...(item.shortcut ? { shortcut: item.shortcut } : {})}
          {...(item.disabled === true ? { disabled: true } : {})}
        >
          {item.items && item.items.length > 0 ? renderData(item.items, `${prefix}-${item.id}`) : undefined}
        </MenuItem>
      )
    })
    )
  }, [])

  // Documentation opens the website's docs page — the SAME link the About
  // dialog shows, resolved off the app version's release channel.
  const handleOpenDocumentation = useCallback((): void => {
    void window.api.app.getVersion().then((version) => {
      const url = docsUrl(resolveChannel(version), i18n.language)
      window.open(url, '_blank', 'noopener,noreferrer')
    })
  }, [i18n])

  return (
    <>
    <Titlebar
      data-testid="main-titlebar"
      title={fileName ? `Restorm - ${fileName}${isDirty ? ' *' : ''}` : t('app.title')}
      showSearchBar
      showNavigation={navigationEnabled}
      // macOS convention: "About" lives in the application menu, opening the
      // in-app modal — the Help menu's own About entry is hidden there (below)
      // to avoid the duplicate.
      {...(isMac ? { appMenuAbout: { label: t('menuBar.about'), onClick: () => { setAboutOpen(true) } } } : {})}
      // The window-control buttons' icons are self-explanatory — drop the hover
      // tooltip (the aria-label stays for a11y).
      customWcoHoverTooltips={false}
      onSearchResultClick={onSearchResultClick}
      renderSearchTooltipContent={renderSearchTooltipContent}
      renderSearchBadge={(method) => <Badge type={mapToBadgeType(method)} />}
      searchBadgedCategories={SEARCH_BADGED_CATEGORIES}
      getSearchResultDragData={searchResultDragData}
      // The search popover hosts a draggable model graph; a fast pan
      // can push the cursor past the popover bounds for a frame
      // before pointer-lock pulls it back, which would dismiss it
      // with the default 300ms grace. 1s is comfortably above that
      // transient window without feeling sticky on normal exits.
      searchTooltipHideDelayMs={1000}
      leftContent={
        <MenuBar data-testid="titlebar-menubar">
          <MenuBarItem title={t('menuBar.file')} data-testid="titlebar-menubar-item-file">
            <MenuItem data-testid="titlebar-menu-item-new" title={t('menuBar.new')} icon={<span className="codicon codicon-new-file" aria-hidden="true" />} shortcut="Ctrl+N" opensDialog onClick={handleMenuNew} />
            <MenuItemSeparator data-testid="titlebar-menu-separator-2" />
            <MenuItem data-testid="titlebar-menu-item-open" title={t('menuBar.open')} icon={<span className="codicon codicon-folder-opened" aria-hidden="true" />} shortcut="Ctrl+O" opensDialog onClick={handleMenuOpen} />
            {fileName && (
              <>
                <MenuItemSeparator data-testid="titlebar-menu-separator-3" />
                <MenuItem data-testid="titlebar-menu-item-save" title={t('menuBar.save')} icon={<span className="codicon codicon-save" aria-hidden="true" />} shortcut="Ctrl+S" onClick={handleMenuSave} />
                <MenuItem data-testid="titlebar-menu-item-save-all" title={t('menuBar.saveAll')} icon={<span className="codicon codicon-save-all" aria-hidden="true" />} shortcut="Ctrl+Shift+S" onClick={handleMenuSaveAll} />
                <MenuItem data-testid="titlebar-menu-item-save-as" title={t('menuBar.saveAs')} icon={<span className="codicon codicon-save-as" aria-hidden="true" />} opensDialog onClick={handleMenuSaveAs} />
              </>
            )}
            {recentFiles.length > 0 && (
              <MenuItem data-testid="titlebar-menu-item-recent-files" title={t('menuBar.recentFiles')} icon={<span className="codicon codicon-history" aria-hidden="true" />}>
                {recentFiles.slice(0, 10).map((file, index) => (
                  <MenuItem
                    key={file.path}
                    data-testid={`titlebar-menu-item-recent-file-${String(index)}`}
                    title={file.name}
                    onClick={() => { onOpenRecentFile(file.path) }}
                  />
                ))}
              </MenuItem>
            )}
            {favorites.length > 0 && (
              <MenuItem data-testid="titlebar-menu-item-favorites" title={t('menuBar.favorites')} icon={<span className="codicon codicon-star-full" aria-hidden="true" />}>
                {favorites.map((file, index) => (
                  <MenuItem
                    key={file.path}
                    data-testid={`titlebar-menu-item-favorite-${String(index)}`}
                    title={file.name}
                    onClick={() => { onOpenRecentFile(file.path) }}
                  />
                ))}
              </MenuItem>
            )}
            {fileName && (
              <>
                <MenuItemSeparator data-testid="titlebar-menu-separator-4" />
                <MenuItem data-testid="titlebar-menu-item-close" title={t('menuBar.close')} icon={<span className="codicon codicon-close" aria-hidden="true" />} onClick={handleMenuClose} />
              </>
            )}
            <MenuItemSeparator data-testid="titlebar-menu-separator-5" />
            <MenuItem data-testid="titlebar-menu-item-exit" title={t('menuBar.exit')} icon={<span className="codicon codicon-sign-out" aria-hidden="true" />} shortcut="Ctrl+Q" onClick={handleMenuExit} />
          </MenuBarItem>
          {/* Édition / Sélection / Affichage / Outils / Aide — items
              are intentionally disabled until each gets wired up. The
              skeleton lands here so the responsive overflow logic in
              ECUI's MenuBar has the full menu surface to test against. */}
          {/* Édition acts on the SIDEBAR selection (cut/copy/paste whole
              items) — text-field editing keeps its native clipboard, which is
              why none of these register Ctrl+X/C/V. The cut/copy/paste/find
              labels resolve from the ECUI core i18n bundle (the app bundle no
              longer carries them) — a rename there changes these entries. */}
          {/* On macOS the native roles below own ⌘Z/⌘X/⌘C/⌘V for text fields, so
              the Edit menu must exist even with no project open — otherwise the
              clipboard stops working in the search bar / settings inputs. The
              selection-dependent items are gated on `fileName` instead. */}
          {(isMac || fileName) && (<MenuBarItem title={t('menuBar.edit')} data-testid="titlebar-menubar-item-edit">
            {/* macOS only: `role` drives the NATIVE menu (the in-window bar is
                not rendered there). Declaring the roles is the only thing that
                makes ⌘Z/⌘X/⌘C/⌘V work in text fields — the role owns its own
                enabled state, targeting whatever has focus. The sidebar
                entries below act on TREE items and cannot carry these roles,
                so both blocks coexist in the mac menu. */}
            {isMac && <MenuItem data-testid="titlebar-menu-item-native-undo" title={t('menuBar.undo')} shortcut="Ctrl+Z" role="undo" disabled />}
            {isMac && <MenuItem data-testid="titlebar-menu-item-native-redo" title={t('menuBar.redo')} shortcut="Ctrl+Shift+Z" role="redo" disabled />}
            {isMac && <MenuItemSeparator data-testid="titlebar-menu-separator-edit-native-1" />}
            {isMac && <MenuItem data-testid="titlebar-menu-item-native-cut" title={t('menuBar.cut')} shortcut="Ctrl+X" role="cut" disabled />}
            {isMac && <MenuItem data-testid="titlebar-menu-item-native-copy" title={t('menuBar.copy')} shortcut="Ctrl+C" role="copy" disabled />}
            {isMac && <MenuItem data-testid="titlebar-menu-item-native-paste" title={t('menuBar.paste')} shortcut="Ctrl+V" role="paste" disabled />}
            {isMac && fileName && <MenuItemSeparator data-testid="titlebar-menu-separator-edit-native-2" />}
            {fileName && (<>
            <MenuItem data-testid="titlebar-menu-item-cut" title={t('menuBar.cut')} icon={<span className="codicon codicon-file-symlink-file" aria-hidden="true" />} disabled={!selection} {...(onCutSelection ? { onClick: onCutSelection } : {})} />
            <MenuItem data-testid="titlebar-menu-item-copy" title={t('menuBar.copy')} icon={<span className="codicon codicon-files" aria-hidden="true" />} disabled={!selection} {...(onCopySelection ? { onClick: onCopySelection } : {})} />
            <MenuItem data-testid="titlebar-menu-item-paste" title={t('menuBar.paste')} icon={<span className="codicon codicon-output" aria-hidden="true" />} disabled={!canPaste} {...(onPasteSelection ? { onClick: onPasteSelection } : {})} />
            <MenuItem data-testid="titlebar-menu-item-clone" title={t('menuBar.clone')} icon={<span className="codicon codicon-copy" aria-hidden="true" />} disabled={!selection} {...(onCloneSelection ? { onClick: onCloneSelection } : {})} />
            <MenuItemSeparator data-testid="titlebar-menu-separator-edit-1" />
            <MenuItem data-testid="titlebar-menu-item-delete" title={t('menuBar.delete')} icon={<span className="codicon codicon-trash" aria-hidden="true" />} disabled={!selection} {...(onDeleteSelection ? { onClick: onDeleteSelection } : {})} />
            <MenuItemSeparator data-testid="titlebar-menu-separator-edit-2" />
            <MenuItem
              data-testid="titlebar-menu-item-toggle-favorite"
              title={selection?.isFavorite === true ? t('menuBar.removeFromFavorites') : t('menuBar.addToFavorites')}
              icon={<span className={`codicon ${selection?.isFavorite === true ? 'codicon-star-full' : 'codicon-star-empty'}`} aria-hidden="true" />}
              disabled={!selection}
              {...(onToggleFavoriteSelection ? { onClick: onToggleFavoriteSelection } : {})}
            />
            <MenuItemSeparator data-testid="titlebar-menu-separator-edit-3" />
            <MenuItem data-testid="titlebar-menu-item-find" title={t('menuBar.find')} icon={<span className="codicon codicon-search" aria-hidden="true" />} shortcut="Ctrl+Shift+F" {...(onFocusSearch ? { onClick: onFocusSearch } : {})} />
            </>)}
          </MenuBarItem>)}
          {/* Créer — Importer (moved out of Fichier), then the same add
              entries as the sidebar context menu's « Ajouter », flattened.
              Placement stays selection-relative: a selected container
              receives the new item inside at the end, a selected leaf gets
              it right after itself, no selection lands at the root. */}
          {fileName && (<MenuBarItem title={t('menuBar.create')} data-testid="titlebar-menubar-item-create">
            <MenuItem data-testid="titlebar-menu-item-import" title={t('menuBar.import')} icon={<span className="codicon codicon-cloud-download" aria-hidden="true" />} shortcut="Ctrl+I" opensDialog onClick={handleImport} />
            <MenuItemSeparator data-testid="titlebar-menu-separator-create-1" />
            {selectionAddSubmenu ? renderMenuData(selectionAddSubmenu, 'titlebar-menu-item-add') : undefined}
          </MenuBarItem>)}
          {/* Requête — shown only while the ACTIVE workbench tab is a CLIENT
              request; acts on that tab (the same Send button the user sees).
              Servers get their own « Serveur » menu below, scenarios the
              « Scénario » one — the three are mutually exclusive, so F5/F8
              always have exactly one owner. */}
          {activeRequestControls && (
            <MenuBarItem title={t('menuBar.request')} data-testid="titlebar-menubar-item-request">
              <MenuItem data-testid="titlebar-menu-item-run-request" title={t('menuBar.runSelected')} icon={<span className="codicon codicon-play" aria-hidden="true" />} shortcut="F5" onClick={activeRequestControls.onRun} />
              <MenuItem data-testid="titlebar-menu-item-cancel-request" title={t('menuBar.cancelSelected')} icon={<span className="codicon codicon-debug-stop" aria-hidden="true" />} shortcut="F8" onClick={activeRequestControls.onCancel} />
            </MenuBarItem>
          )}
          {/* Serveur — shown only while the ACTIVE workbench tab is a server
              editor; its entries mirror that editor's own action buttons
              (published by the editor, so behaviour and enablement are the
              button's, toasts included). */}
          {activeServerMenu && (
            <MenuBarItem title={t('menuBar.server')} data-testid="titlebar-menubar-item-server">
              {renderMenuData(activeServerMenu, 'titlebar-menu-item-server')}
            </MenuBarItem>
          )}
          {/* Scénario — shown only while the ACTIVE workbench tab is a
              scenario editor; its items ARE the editor's empty-canvas
              palette. */}
          {activeScenarioPalette && (
            <MenuBarItem title={t('menuBar.scenario')} data-testid="titlebar-menubar-item-scenario">
              {renderMenuData(activeScenarioPalette, 'titlebar-menu-item-scenario')}
            </MenuBarItem>
          )}
          {/* Affichage (the old Outils menu is gone; this menu briefly
              carried the name « Options » during the overhaul). */}
          <MenuBarItem title={t('menuBar.view')} data-testid="titlebar-menubar-item-view">
            <MenuItem
              data-testid="titlebar-menu-item-console"
              title={t('menuBar.consoleHttp', 'HTTP console')}
              icon={<span className="codicon codicon-terminal" aria-hidden="true" />}
              onClick={onOpenConsole}
            />
            <MenuItem
              data-testid="titlebar-menu-item-firewall"
              title={t('menuBar.firewall', 'Firewall')}
              icon={<span className="codicon codicon-shield" aria-hidden="true" />}
              onClick={onOpenFirewall}
            />
            <MenuItem
              data-testid="titlebar-menu-item-mini-browser"
              title={t('menuBar.miniBrowser', 'Mini browser')}
              icon={<span className="codicon codicon-browser" aria-hidden="true" />}
              onClick={onOpenMiniBrowser}
            />
            <MenuItem
              data-testid="titlebar-menu-item-mcp-logs"
              title={t('menuBar.mcpLogs')}
              icon={<span className="codicon codicon-mcp" aria-hidden="true" />}
              onClick={onOpenMcpLogs}
              disabled={!mcpEnabled}
            />
            <MenuItemSeparator data-testid="titlebar-menu-separator-view-1" />
            <MenuItem
              data-testid="titlebar-menu-item-settings"
              title={t('menuBar.settings')}
              icon={<span className="codicon codicon-settings-gear" aria-hidden="true" />}
              onClick={handleOpenSettings}
            />
            <MenuItemSeparator data-testid="titlebar-menu-separator-view-2" />
            <MenuItem data-testid="titlebar-menu-item-toggle-fullscreen" title={t('menuBar.toggleFullscreen')} icon={<span className="codicon codicon-screen-full" aria-hidden="true" />} onClick={handleToggleFullscreen} />
          </MenuBarItem>
          {fileName && (<MenuBarItem
            // A plain string, not a rich `<Badge>` node: `MenuBar`'s
            // overflow/hamburger conversion (`menuBarItemToMenuItem`)
            // renders a top-level item's title through ECUI's `MenuItem`,
            // whose own `title` prop is `string`-only (used in a
            // `${title}…` template literal for the opensDialog ellipsis)
            // — a JSX title silently renders as an EMPTY row there once
            // the bar collapses to overflow (confirmed live). "(Pro)"
            // keeps the untranslated "Pro" wording AC#5 asks for without
            // that regression; the styled `Badge` pill stays reserved for
            // surfaces that don't feed through this conversion (the
            // status bar already uses it via `GatedControl`).
            title={gitGate.kind === 'community' ? `${t('menuBar.git')} (Pro)` : t('menuBar.git')}
            data-testid="titlebar-menubar-item-git"
          >
            <MenuItem
              data-testid="titlebar-menu-item-git-refresh"
              title={t('menuBar.gitRefresh')}
              icon={<span className="codicon codicon-refresh" aria-hidden="true" />}
              onClick={onGitRefresh}
              disabled={gitGate.locked}
            />
            <MenuItem
              data-testid="titlebar-menu-item-git-push"
              title={t('menuBar.gitPush')}
              icon={<GitMenuIcon codicon="repo-push" pending={gitPushPending} data-testid="titlebar-menu-item-git-push-pastille" />}
              onClick={onGitPush}
              disabled={gitGate.locked}
            />
            <MenuItem
              data-testid="titlebar-menu-item-git-pull"
              title={t('menuBar.gitPull')}
              icon={<GitMenuIcon codicon="repo-pull" pending={gitPullPending} data-testid="titlebar-menu-item-git-pull-pastille" />}
              onClick={onGitPull}
              disabled={gitGate.locked}
            />
            <MenuItemSeparator data-testid="titlebar-menu-separator-git-1" />
            <MenuItem
              data-testid="titlebar-menu-item-git-reset-to-server"
              title={t('menuBar.gitResetToServer')}
              icon={<span className="codicon codicon-discard" aria-hidden="true" />}
              onClick={onGitResetToServer}
              disabled={gitGate.locked}
            />
            <MenuItemSeparator data-testid="titlebar-menu-separator-git-2" />
            <MenuItem
              data-testid="titlebar-menu-item-git-history"
              title={t('menuBar.gitHistory')}
              icon={<span className="codicon codicon-source-control" aria-hidden="true" />}
              onClick={onGitHistory}
              disabled={gitGate.locked}
            />
          </MenuBarItem>)}
          <MenuBarItem title={t('menuBar.help')} data-testid="titlebar-menubar-item-help">
            {!isMac && (
              <MenuItem
                data-testid="titlebar-menu-item-about"
                title={t('menuBar.about')}
                icon={<span className="codicon codicon-info" aria-hidden="true" />}
                onClick={() => { setAboutOpen(true) }}
              />
            )}
            <MenuItem data-testid="titlebar-menu-item-documentation" title={t('menuBar.documentation')} icon={<span className="codicon codicon-book" aria-hidden="true" />} onClick={handleOpenDocumentation} />
            <MenuItem
              data-testid="titlebar-menu-item-release-notes"
              title={t('menuBar.releaseNotes')}
              icon={<span className="codicon codicon-list-unordered" aria-hidden="true" />}
              onClick={() => {
                eventBus.emitLocalSync(RELEASE_NOTES_OPEN, { mode: 'recent' } as ReleaseNotesOpenPayload)
              }}
            />
            {updateSettings?.autoUpdateSupported === true && (
              <MenuItem
                data-testid="titlebar-menu-item-check-updates"
                title={t('menuBar.checkForUpdates')}
                icon={<span className="codicon codicon-sync" aria-hidden="true" />}
                onClick={() => { void checkForUpdates() }}
              />
            )}
          </MenuBarItem>
        </MenuBar>
      }
      rightContent={
        <>
          <AccountButton
            dashboardUrl={DASHBOARD_URL}
            /* Contributed by the app, not built into the library: the account
               card stays generic and knows nothing about CLI tokens. */
            extraActions={[
              {
                id: 'cli-tokens',
                icon: 'key',
                label: t('cliTokens.title'),
                onSelect: () => { setCliTokensOpen(true); }
              },
              {
                id: 'cookies',
                icon: 'globe',
                label: t('cookies.title', 'Cookies'),
                onSelect: () => { setCookieManagerOpen(true); }
              }
            ]}
          />
          <HeaderHoverTooltip label={t('app.openSettings')}>
            <Button
              data-testid="titlebar-settings-button"
              small
              secondary
              icon="gear"
              onClick={handleOpenSettings}
              options={{
                ariaLabel: t('app.openSettings')
              }}
            />
          </HeaderHoverTooltip>
        </>
      }
    />
    <AboutModal isOpen={aboutOpen} onClose={handleCloseAbout} />
    <CliTokensModal isOpen={cliTokensOpen} onClose={() => { setCliTokensOpen(false); }} />
    <CookieManagerModal isOpen={cookieManagerOpen} onClose={() => { setCookieManagerOpen(false); }} />
    </>
  )
}

/** Menu-item icon with the same pastille dot as the statusbar GIT cell —
 * the top-level "Git" MenuBarItem title stays a plain string (overflow/
 * hamburger conversion is string-only, see its own comment above), so the
 * pending indicators live on the dropdown items instead. */
const GitMenuIcon: React.FC<{ codicon: string; pending: boolean; 'data-testid'?: string }> = ({ codicon, pending, 'data-testid': dataTestId }) => (
  <span style={{ position: 'relative', display: 'inline-flex' }}>
    <span className={`codicon codicon-${codicon}`} aria-hidden="true" />
    {pending && (
      <span
        aria-hidden="true"
        {...(dataTestId ? { 'data-testid': dataTestId } : {})}
        style={{
          position: 'absolute',
          top: -1,
          right: -2,
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: 'var(--statusBar-prominentBackground, var(--focusBorder))'
        }}
      />
    )}
  </span>
)
