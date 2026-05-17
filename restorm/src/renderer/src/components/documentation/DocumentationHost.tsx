import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dock, type DockHandle, MarkdownViewer, ScrollableElement } from 'electron-core-ui/renderer'
import type {
  ApiDocumentation,
  OperationDocumentation
} from '../../../../shared/types/apiDocumentation'
import type { RouteLike } from '../../../../shared/utils/findOperationForRoute'
import { selectDocSlice } from '../../../../shared/utils/selectDocSlice'
import { ApiInfoSection } from './ApiInfoSection'
import { CompositionSection } from './CompositionSection'
import { DocumentationHostNativeFind, type DocumentationHostNativeFindHandle } from './DocumentationHostNativeFind'
import { DocumentationHostSearch, type DocumentationHostSearchHandle } from './DocumentationHostSearch'
import { DocumentationSidebar } from './DocumentationSidebar'
import { DocumentationModelsContext, DocumentationSecuritySchemesContext } from './documentationModels'
import { DocumentationNavigationContext, type DocumentationNavigationApi } from './documentationNavigation'
import { EnumsSection } from './EnumsSection'
import { ModelGraph, type ModelGraphHandle } from './ModelGraph'
import { ModelGraphLegend } from './ModelGraphLegend'
import { OperationExtras } from './OperationExtras'
import { ParametersTable } from './ParametersTable'
import { ResponsesTable } from './ResponsesTable'
import { RouteHeader } from './RouteHeader'
import './DocumentationHost.css'

export interface DocumentationHostProps {
  /** Full structured documentation owned by the parent EnvironmentFolder. */
  apiDocumentation: ApiDocumentation
  /** Route filters narrowing which operations get rendered, and by
   * extension which models (transitive closure of every filtered op's
   * referenced models, deduplicated). Empty / undefined ⇒ show every
   * operation + every model. Each filter resolves through the same
   * matcher the rest of the app uses (`findOperationForRoute`). */
  filters?: RouteLike[]
  /** Optional title rendered as H1 above the route blocks. Used by
   * the env-folder and folder docs to anchor the document with the
   * API / folder name. Single-route scopes leave this undefined —
   * the route summary is the H1. */
  scopeTitle?: string
  /** Optional markdown rendered immediately under the scope title.
   * Pulled from `apiDocumentation.api.description` for env folders. */
  scopeDescription?: string
  /** Wired by multi-route hosts (folder doc) to spawn a fresh
   * pre-configured request from any route block. When provided,
   * each route's RouteHeader exposes an "Add" button. */
  onAddRequest?: (operation: OperationDocumentation) => void
  /** Force-hide every per-route "+ Add a request" button regardless
   * of whether `onAddRequest` is wired. Read-only consumers (e.g.
   * the Import modal's Documentation preview tab) set this so the
   * doc surface stays advisory. */
  hideAddRequest?: boolean
  /** Render the API info block (version / contact / license /
   * terms / external docs / server / source) under the scope
   * header. Set by the env-folder Docs2 wiring; folder / single-
   * route scopes leave it `false`. */
  showApiInfo?: boolean
  /** Optional test id stamped on the root container. */
  testId?: string
}

/**
 * Documentation host — single rendering surface for structured API
 * documentation. Consumes the parsed `ApiDocumentation` directly and
 * exposes a route-based filter API; per-surface scope (request, env
 * folder, folder, multi-route) is just a matter of passing the
 * right `filters` array, optionally with a `scopeTitle` /
 * `scopeDescription` for the outer anchor.
 *
 * Heading hierarchy:
 * - **single route** (operations.length === 1): the route summary
 *   is the H1, Parameters / Responses / Models are H1 (siblings).
 * - **multi route** (operations.length > 1): the scope title is
 *   the only H1; per-route summaries and the per-route Parameters
 *   / Responses sections render as H2; Models is H1 (sibling of
 *   the scope title).
 */
export const DocumentationHost: React.FC<DocumentationHostProps> = ({
  apiDocumentation,
  filters,
  scopeTitle,
  scopeDescription,
  onAddRequest,
  hideAddRequest = false,
  showApiInfo = false,
  testId
}) => {
  /** Resolve the effective `onAddRequest` once: when `hideAddRequest`
   * is set, force-drop the callback even if a parent wired one. The
   * route block + RouteHeader treat "no callback" as "no button", so
   * a single source of truth here keeps every downstream check
   * aligned. */
  const effectiveOnAddRequest = hideAddRequest ? undefined : onAddRequest
  const slice = useMemo(
    () => selectDocSlice(apiDocumentation, filters),
    [apiDocumentation, filters]
  )
  const { operations, models } = slice

  const isSingleRoute = operations.length === 1
  /** When the host renders the env-folder Docs tab (`showApiInfo`)
   * and there's more than one route, we group operations under per-
   * tag H2 headers so pet/store/user (etc) read as distinct
   * sections. The route-level summary then drops to H3 to keep the
   * heading hierarchy well-formed under the H1 scope title. */
  const useGroupedLayout = showApiInfo && !isSingleRoute && slice.groups.length > 0
  const sectionHeadingLevel: 1 | 2 | 3 = isSingleRoute
    ? 1
    : useGroupedLayout
      ? 3
      : 2
  /** Top-level section titles (Models, Enums) sit as siblings of the
   * scope title when present, so they drop to H2. Without a scope
   * title (single-route view) they read as H1 — peers of the route
   * summary. */
  const hasScopeTitle = scopeTitle !== undefined && scopeTitle.length > 0
  const topLevelSectionLevel: 1 | 2 = hasScopeTitle ? 2 : 1

  /** Sidebar Dock state — local to this host instance. The toggle
   * button rendered inside the panel drives `Dock` through the
   * imperative `toggle()` ref so the visual chrome can swap
   * (chevron-left / chevron-right) without each call site owning
   * the collapsed flag. */
  const [sidebarDockCollapsed, setSidebarDockCollapsed] = useState(false)
  const [sidebarDockSize, setSidebarDockSize] = useState(220)
  const sidebarDockRef = useRef<DockHandle>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<DocumentationHostSearchHandle>(null)
  const nativeFindRef = useRef<DocumentationHostNativeFindHandle>(null)
  const modelsSectionRef = useRef<HTMLElement>(null)
  const modelGraphRef = useRef<ModelGraphHandle>(null)
  const enumsSectionRef = useRef<HTMLElement>(null)

  // Sidebar (operations + models outline) only earns its keep when
  // there is more than one route OR the host is currently rendering
  // its own scope title (env-folder / folder doc). A bare
  // single-route view stays sidebar-less to keep the docs panel
  // focused on the operation card itself.
  const showSidebar = operations.length > 1 || (scopeTitle !== undefined && scopeTitle.length > 0)

  const modelNames = useMemo<Set<string>>(
    () => new Set(models.map((m) => m.name)),
    [models]
  )
  /** Bucket the in-scope operations by their `group` (tag) in the
   * order the spec declares the groups. `(ungrouped)` collects
   * orphan operations that have no `group` field — kept last so the
   * named tags remain at the top. */
  const groupedOperations = useMemo(() => {
    const map = new Map<string, OperationDocumentation[]>()
    for (const g of slice.groups) map.set(g.name, [])
    for (const op of operations) {
      const key = op.group ?? '(ungrouped)'
      if (!map.has(key)) map.set(key, [])
      map.get(key)?.push(op)
    }
    const groupByName = new Map(slice.groups.map((g) => [g.name, g]))
    return Array.from(map.entries())
      .filter(([, ops]) => ops.length > 0)
      .map(([name, ops]) => ({
        name,
        description: groupByName.get(name)?.description,
        externalDocs: groupByName.get(name)?.externalDocs,
        operations: ops
      }))
  }, [slice.groups, operations])
  const securitySchemes = apiDocumentation.securitySchemes ?? {}

  const navigationApi = useMemo<DocumentationNavigationApi>(() => ({
    scrollToTop: (): void => {
      const root = rootRef.current
      if (!root) return
      const header = root.querySelector<HTMLElement>('[data-testid="documentation-host-scope-header"]')
      if (header) {
        header.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      // No scope header (single route inside a request tab) — fall
      // back to scrolling the host's root element into view, which
      // climbs the surrounding ScrollableElement to its top.
      root.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    scrollToOperation: (slug: string): void => {
      const root = rootRef.current
      if (!root) return
      const target = root.querySelector<HTMLElement>(`[data-doc-op="${cssEscape(slug)}"]`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    scrollToModel: (name: string): void => {
      modelsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // Run the canvas pan after the scroll begins so React Flow
      // has finished any pending layout reflow before we centre on
      // the node — without the rAF the pan animation can land on
      // a stale viewport rect.
      requestAnimationFrame(() => {
        modelGraphRef.current?.focusModel(name)
      })
    },
    scrollToEnum: (modelName: string, propertyName?: string): void => {
      const root = rootRef.current
      if (!root) return
      const target = propertyName !== undefined && propertyName.length > 0
        ? root.querySelector<HTMLElement>(`[data-testid="documentation-host-enums-${cssEscape(modelName)}-${cssEscape(propertyName)}"]`)
        : root.querySelector<HTMLElement>(`[data-testid="documentation-host-enums-model-${cssEscape(modelName)}"]`)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      enumsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    scrollToOperations: (): void => {
      const root = rootRef.current
      if (!root) return
      const firstGroup = root.querySelector<HTMLElement>('[data-doc-group]')
        ?? root.querySelector<HTMLElement>('[data-doc-op]')
      firstGroup?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }), [])

  // Ctrl+F (or Cmd+F) opens Chromium's native `findInPage` bar;
  // Ctrl+Shift+F opens the JS-side custom search bar (CSS Custom
  // Highlight API, scoped to the host root). F3 / Shift+F3 step
  // through whichever bar is currently open. We listen at the
  // window level so the shortcut works without the host being
  // focused, but gate on host visibility (`offsetParent`) so the
  // inactive tab panels (Tabs uses `visibility: hidden`) don't all
  // hijack the keystroke at once. Monaco binds Ctrl+F at the
  // editor level and stops propagation, so editors keep their
  // native find-bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const root = rootRef.current
      if (!root?.offsetParent) return
      const isF = (e.key === 'f' || e.key === 'F') && (e.ctrlKey || e.metaKey)
      if (isF && e.shiftKey) {
        e.preventDefault()
        searchRef.current?.open()
        return
      }
      if (isF) {
        e.preventDefault()
        nativeFindRef.current?.open()
        return
      }
      if (e.key === 'F3') {
        e.preventDefault()
        const handle = nativeFindRef.current?.isOpen() === true
          ? nativeFindRef.current
          : searchRef.current?.isOpen() === true
            ? searchRef.current
            : nativeFindRef.current  // default to native when neither is open
        if (e.shiftKey) handle?.previous()
        else handle?.next()
        return
      }
      if (e.key === 'Escape') {
        if (searchRef.current?.isOpen() === true) {
          e.preventDefault()
          searchRef.current.close()
        } else if (nativeFindRef.current?.isOpen() === true) {
          e.preventDefault()
          nativeFindRef.current.close()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [])

  // Anchors inside the documentation host (markdown descriptions,
  // externalDocs links, contact URLs, …) should open in the user's
  // default browser, not in a new Electron window. The main process
  // also installs a `setWindowOpenHandler` that routes window.open
  // through `shell.openExternal`, so pre-empting via window.open
  // here is the simplest path that needs no extra preload bridge.
  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement | null
    const anchor = target?.closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href')
    if (href === null || !/^https?:\/\//i.test(href)) return
    event.preventDefault()
    window.open(href, '_blank', 'noopener,noreferrer')
  }, [])

  /** Main column — scope header, route blocks (grouped or flat), Models,
   * Composition, Enums. Rendered either inside the sidebar Dock as the
   * `children` payload or directly when the host runs without a sidebar
   * (single-route view). Kept as a closure rather than a sub-component
   * so it captures every parent ref / state without prop drilling. */
  const renderMain = (): React.ReactNode => (
    <ScrollableElement className="documentation-host__main-scroll">
    <div className="documentation-host__main">
      {scopeTitle !== undefined && scopeTitle.length > 0 && (
        <header
          className="documentation-host__scope-header"
          data-testid="documentation-host-scope-header"
        >
          <h1 className="documentation-host__scope-title">{scopeTitle}</h1>
          {scopeDescription !== undefined && scopeDescription.length > 0 && (
            <MarkdownViewer
              value={scopeDescription}
              data-testid="documentation-host-scope-description"
            />
          )}
          {showApiInfo && <ApiInfoSection apiDocumentation={apiDocumentation} />}
        </header>
      )}

      {useGroupedLayout
        ? groupedOperations.map((group) => (
          <section
            key={group.name}
            className="documentation-host__group-section"
            data-doc-group={group.name}
            data-testid={`documentation-host-group-${group.name}`}
          >
            <header className="documentation-host__group-header">
              <h2 className="documentation-host__group-title">{group.name}</h2>
              {group.description !== undefined && group.description.length > 0 && (
                <MarkdownViewer
                  value={group.description}
                  data-testid={`documentation-host-group-description-${group.name}`}
                />
              )}
            </header>
            {group.operations.map((op, idx) => (
              <RouteBlock
                key={`${op.operationId ?? op.match.urlPattern}-${String(idx)}`}
                operation={op}
                headingLevel={sectionHeadingLevel}
                showGroupChip={false}
                {...(effectiveOnAddRequest ? { onAddRequest: effectiveOnAddRequest } : {})}
              />
            ))}
          </section>
        ))
        : operations.map((op, idx) => (
          <RouteBlock
            key={`${op.operationId ?? op.match.urlPattern}-${String(idx)}`}
            operation={op}
            headingLevel={sectionHeadingLevel}
            showGroupChip={!isSingleRoute}
            {...(effectiveOnAddRequest && !isSingleRoute ? { onAddRequest: effectiveOnAddRequest } : {})}
          />
        ))}

      {models.length > 0 ? (
        <section
          ref={modelsSectionRef}
          className="documentation-host__section documentation-host__models"
          data-testid="documentation-host-models-section"
        >
          {topLevelSectionLevel === 1
            ? <h1 className="documentation-host__section-title">Models</h1>
            : <h2 className="documentation-host__section-title">Models</h2>}
          <ModelGraph ref={modelGraphRef} models={models} />
          <ModelGraphLegend />
        </section>
      ) : null}

      <CompositionSection models={models} headingLevel={topLevelSectionLevel} />
      <EnumsSection ref={enumsSectionRef} models={models} headingLevel={topLevelSectionLevel} />
    </div>
    </ScrollableElement>
  )

  return (
    <DocumentationNavigationContext.Provider value={navigationApi}>
    <DocumentationModelsContext.Provider value={modelNames}>
    <DocumentationSecuritySchemesContext.Provider value={securitySchemes}>
      <div
        ref={rootRef}
        className={`documentation-host${showSidebar ? ' documentation-host--with-sidebar' : ''}${sidebarDockCollapsed ? ' documentation-host--sidebar-collapsed' : ''}`}
        data-testid={testId ?? 'documentation-host'}
        data-operation-count={String(operations.length)}
        data-model-count={String(models.length)}
        onClick={handleClick}
      >
        <DocumentationHostNativeFind ref={nativeFindRef} />
        <DocumentationHostSearch ref={searchRef} rootRef={rootRef} />
        {showSidebar ? (
          <Dock
            ref={sidebarDockRef}
            side="right"
            size={sidebarDockSize}
            onSizeChange={setSidebarDockSize}
            collapsed={sidebarDockCollapsed}
            onCollapsedChange={setSidebarDockCollapsed}
            minSize={160}
            collapsedSize={38}
            previewOnHover
            data-testid="documentation-host-dock"
            panelOverlay={(
              <Button
                icon={sidebarDockCollapsed ? 'pin' : 'pinned'}
                options={{
                  ariaLabel: sidebarDockCollapsed
                    ? 'Expand documentation sidebar'
                    : 'Collapse documentation sidebar'
                }}
                data-testid="documentation-host-sidebar-toggle"
                onClick={(): void => { sidebarDockRef.current?.toggle() }}
                className="documentation-host__sidebar-dock-toggle documentation-host__sidebar-dock-toggle--anchored"
              />
            )}
            panel={(
              <DocumentationSidebar
                operations={operations}
                models={models}
                operationSlug={getOperationSlug}
                {...(scopeTitle !== undefined && scopeTitle.length > 0 ? { scopeTitle } : {})}
              />
            )}
          >
            {renderMain()}
          </Dock>
        ) : (
          renderMain()
        )}
      </div>
    </DocumentationSecuritySchemesContext.Provider>
    </DocumentationModelsContext.Provider>
    </DocumentationNavigationContext.Provider>
  )
}

function getOperationSlug(operation: OperationDocumentation): string {
  return operation.operationId ?? operation.match.urlPattern
}

function cssEscape(value: string): string {
  // Use the browser-provided CSS.escape when available; fall back to
  // a manual escape (the only characters in our slugs that require
  // escaping in attribute selectors are `/`, `{`, `}`, and `:`).
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/(["\\])/g, '\\$1')
}

interface RouteBlockProps {
  operation: OperationDocumentation
  headingLevel: 1 | 2 | 3
  showGroupChip: boolean
  onAddRequest?: (operation: OperationDocumentation) => void
}

const RouteBlock: React.FC<RouteBlockProps> = ({ operation, headingLevel, showGroupChip, onAddRequest }) => {
  const SectionHeading = headingLevel === 1 ? 'h1' : headingLevel === 2 ? 'h2' : 'h3'
  const opIdSlug = getOperationSlug(operation)
  return (
    <article
      className="documentation-host__route-block"
      data-doc-op={opIdSlug}
      data-testid={`documentation-host-route-${opIdSlug}`}
    >
      <RouteHeader
        operation={operation}
        headingLevel={headingLevel}
        showGroupChip={showGroupChip}
        {...(onAddRequest ? { onAddRequest } : {})}
      />
      {(operation.parameters?.length ?? 0) > 0 && (
        <section
          className="documentation-host__section documentation-host__section--parameters"
          data-testid={`documentation-host-parameters-section-${opIdSlug}`}
        >
          <SectionHeading className="documentation-host__section-title">Parameters</SectionHeading>
          <ParametersTable operations={[operation]} />
        </section>
      )}
      {operation.responses && Object.keys(operation.responses).length > 0 && (
        <section
          className="documentation-host__section documentation-host__section--responses"
          data-testid={`documentation-host-responses-section-${opIdSlug}`}
        >
          <SectionHeading className="documentation-host__section-title">Responses</SectionHeading>
          <ResponsesTable operations={[operation]} />
        </section>
      )}
      <OperationExtras operation={operation} />
    </article>
  )
}
