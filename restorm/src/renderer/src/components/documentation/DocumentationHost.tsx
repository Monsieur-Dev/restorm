import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { MarkdownViewer } from 'electron-core-ui/renderer'
import type {
  ApiDocumentation,
  ModelDocumentation,
  OperationDocumentation
} from '../../../../shared/types/apiDocumentation'
import { findOperationForRoute, type RouteLike } from '../../../../shared/utils/findOperationForRoute'
import { ApiInfoSection } from './ApiInfoSection'
import { DocumentationHostSearch, type DocumentationHostSearchHandle } from './DocumentationHostSearch'
import { DocumentationSidebar } from './DocumentationSidebar'
import { DocumentationModelsContext } from './documentationModels'
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
   * Pulled from `apiDocumentation.api.description` for env folders
   * and from the user-authored `folder.documentation` for folders. */
  scopeDescription?: string
  /** Wired by multi-route hosts (folder doc) to spawn a fresh
   * pre-configured request from any route block. When provided,
   * each route's RouteHeader exposes an "Add" button. */
  onAddRequest?: (operation: OperationDocumentation) => void
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
  showApiInfo = false,
  testId
}) => {
  const operations = useMemo<OperationDocumentation[]>(
    () => filterOperations(apiDocumentation, filters),
    [apiDocumentation, filters]
  )
  const models = useMemo<ModelDocumentation[]>(
    () => transitiveModelClosure(apiDocumentation, operations, filters),
    [apiDocumentation, operations, filters]
  )

  const isSingleRoute = operations.length === 1
  const sectionHeadingLevel: 1 | 2 = isSingleRoute ? 1 : 2

  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<DocumentationHostSearchHandle>(null)
  const modelsSectionRef = useRef<HTMLElement>(null)
  const modelGraphRef = useRef<ModelGraphHandle>(null)

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

  const navigationApi = useMemo<DocumentationNavigationApi>(() => ({
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
    }
  }), [])

  // Ctrl+F (or Cmd+F on macOS) opens the in-doc search; F3 /
  // Shift+F3 step through matches once the bar is open. We listen at
  // the window level so the shortcut works without the host being
  // focused, but gate on host visibility (`offsetParent !== null`)
  // so the inactive tab panels (Tabs uses `visibility: hidden`)
  // don't all hijack the keystroke at once. Monaco binds Ctrl+F at
  // the editor level and stops propagation, so editors keep their
  // native find-bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const root = rootRef.current
      if (!root?.offsetParent) return
      const isFind = (e.key === 'f' || e.key === 'F') && (e.ctrlKey || e.metaKey)
      if (isFind) {
        e.preventDefault()
        searchRef.current?.open()
        return
      }
      if (e.key === 'F3') {
        e.preventDefault()
        if (e.shiftKey) searchRef.current?.previous()
        else searchRef.current?.next()
        return
      }
      if (e.key === 'Escape' && searchRef.current?.isOpen() === true) {
        e.preventDefault()
        searchRef.current.close()
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

  return (
    <DocumentationNavigationContext.Provider value={navigationApi}>
    <DocumentationModelsContext.Provider value={modelNames}>
      <div
        ref={rootRef}
        className={`documentation-host${showSidebar ? ' documentation-host--with-sidebar' : ''}`}
        data-testid={testId ?? 'documentation-host'}
        data-operation-count={String(operations.length)}
        data-model-count={String(models.length)}
        onClick={handleClick}
      >
        <DocumentationHostSearch ref={searchRef} rootRef={rootRef} />
        {showSidebar && (
          <DocumentationSidebar
            operations={operations}
            models={models}
            operationSlug={getOperationSlug}
          />
        )}
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

          {operations.map((op, idx) => (
            <RouteBlock
              key={`${op.operationId ?? op.match.urlPattern}-${String(idx)}`}
              operation={op}
              headingLevel={sectionHeadingLevel}
              showGroupChip={!isSingleRoute}
              {...(onAddRequest && !isSingleRoute ? { onAddRequest } : {})}
            />
          ))}

          {models.length > 0 ? (
            <section
              ref={modelsSectionRef}
              className="documentation-host__section documentation-host__models"
              data-testid="documentation-host-models-section"
            >
              <h1 className="documentation-host__section-title">Models</h1>
              <ModelGraph ref={modelGraphRef} models={models} />
              <ModelGraphLegend />
            </section>
          ) : null}

          <EnumsSection models={models} />
        </div>
      </div>
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
  headingLevel: 1 | 2
  showGroupChip: boolean
  onAddRequest?: (operation: OperationDocumentation) => void
}

const RouteBlock: React.FC<RouteBlockProps> = ({ operation, headingLevel, showGroupChip, onAddRequest }) => {
  const SectionHeading = headingLevel === 1 ? 'h1' : 'h2'
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

// ──────────────────────────────────────────────────────────────────
// Filter helpers
// ──────────────────────────────────────────────────────────────────

function filterOperations(
  apiDoc: ApiDocumentation,
  filters: RouteLike[] | undefined
): OperationDocumentation[] {
  if (!filters || filters.length === 0) return apiDoc.operations
  const matched = new Set<OperationDocumentation>()
  for (const filter of filters) {
    const op = findOperationForRoute(apiDoc, filter)
    if (op) matched.add(op)
  }
  return Array.from(matched)
}

/**
 * Walk every filtered operation's `referencedModels` plus every
 * property's `targetModelRef` to produce the deduplicated transitive
 * closure of models the filtered routes consume. Without filters,
 * returns every model declared in the spec.
 */
function transitiveModelClosure(
  apiDoc: ApiDocumentation,
  operations: OperationDocumentation[],
  filters: RouteLike[] | undefined
): ModelDocumentation[] {
  if (!filters || filters.length === 0) return Object.values(apiDoc.models)
  const visited = new Set<string>()
  const queue: string[] = []
  for (const op of operations) {
    if (op.referencedModels) {
      for (const name of op.referencedModels) queue.push(name)
    }
  }
  while (queue.length > 0) {
    const name = queue.shift()
    if (name === undefined || visited.has(name)) continue
    visited.add(name)
    const model = apiDoc.models[name]
    if (!model) continue
    for (const prop of model.properties) {
      if (prop.targetModelRef !== undefined && !visited.has(prop.targetModelRef)) {
        queue.push(prop.targetModelRef)
      }
    }
  }
  const closure: ModelDocumentation[] = []
  for (const name of visited) {
    const m = apiDoc.models[name]
    if (m) closure.push(m)
  }
  return closure
}
