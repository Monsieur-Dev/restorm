/**
 * SearchTooltipContent — popover content for a search result.
 *
 * Behaviour:
 * - request: when the parent env-folder owns an `apiDocumentation` AND
 *   the request's route matches an operation, render the
 *   `DocumentationHost` filtered to that route — the popover becomes
 *   the same Docs surface the request tab view shows. Otherwise fall
 *   back to the legacy method+URL+headers+body summary built from the
 *   search metadata.
 * - env-folder: when `apiDocumentation` is present, render the full
 *   `DocumentationHost` (folder-scoped). Otherwise fall back to the
 *   notes-only popover.
 * - plain folder: notes-only popover (folders don't carry structured
 *   docs).
 *
 * Bookmark ribbon + breadcrumb are always kept regardless of branch.
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Handlebars from 'handlebars'
import { MarkdownViewer, Tabs, type Tab, type SearchResult, BookmarkRibbonStack, type Bookmark } from 'electron-core-ui/renderer'
import type { RestormSearchMetadata } from '../../../services/SearchIndexService'
import requestDetailsTemplate from '../../../resources/templates/search/request-details.hbs?raw'
import { Badge } from '../../common/Badge'
import { mapToBadgeType } from '../../../utils/badgeUtils'
import { DocumentationHost } from '../../documentation/DocumentationHost'
import { mergeEnumDefinitionsIntoModels } from '../../documentation/mergeEnumDefinitions'
import { useRestormStore } from '../../../store/restormStore'
import { findOperationForRoute, type RouteLike } from '../../../../../shared/utils/findOperationForRoute'
import { routeFromRequest } from '../../../hooks/routeFromRequest'
import { resolveUrlAgainstEnv, flattenEnvVars } from '../../../../../shared/utils/resolveUrlAgainstEnv'
import { isEnvironmentFolder, isRequest, isAnyFolder } from '../../../../../shared/types/folderTypes'
import { isScenario } from '../../../../../shared/types/collections'
import type { EnvironmentFolder, Folder, Scenario } from '../../../../../shared/types/collections'
import type { Request } from '../../../../../shared/types/collections'
import { ScenarioGraphPreview } from './ScenarioGraphPreview'
import './SearchTooltipContent.css'

const compiledTemplate = Handlebars.compile(requestDetailsTemplate)
Handlebars.registerHelper('ifEquals', function (this: unknown, arg1: unknown, arg2: unknown, options: Handlebars.HelperOptions) {
  return arg1 === arg2 ? options.fn(this) : options.inverse(this)
})

interface SearchTooltipContentProps {
  result: SearchResult
}

/**
 * Pull the request and its parent env-folder out of the live
 * collections tree. We need the parent's `apiDocumentation` + the
 * env's variables to env-resolve the route before matching it
 * against the doc — the same path the request tab view takes.
 */
function findRequestWithParent(
  collections: EnvironmentFolder[],
  requestId: string
): { request: Request; parent: EnvironmentFolder } | null {
  for (const envFolder of collections) {
    const found = walkFolder(envFolder, requestId)
    if (found) return { request: found, parent: envFolder }
  }
  return null
}

function walkFolder(folder: Folder | EnvironmentFolder, requestId: string): Request | null {
  for (const item of folder.items) {
    if (isRequest(item) && item.id === requestId) return item
    if (isAnyFolder(item)) {
      const inner = walkFolder(item, requestId)
      if (inner) return inner
    }
  }
  return null
}

function findFolderInTree(
  collections: EnvironmentFolder[],
  folderId: string
): Folder | EnvironmentFolder | null {
  for (const envFolder of collections) {
    if (envFolder.id === folderId) return envFolder
    const inner = walkForFolder(envFolder, folderId)
    if (inner) return inner
  }
  return null
}

function walkForFolder(folder: Folder | EnvironmentFolder, folderId: string): Folder | EnvironmentFolder | null {
  for (const item of folder.items) {
    if (!isAnyFolder(item)) continue
    if (item.id === folderId) return item
    const inner = walkForFolder(item, folderId)
    if (inner) return inner
  }
  return null
}

/** Walk the tree to find the scenario the result references.
 * Scenarios can live at the root, inside an env-folder / folder,
 * or nested inside another scenario (folder-like container). */
function findScenarioInTree(
  collections: EnvironmentFolder[],
  scenarioId: string
): Scenario | null {
  for (const envFolder of collections) {
    const found = walkForScenario(envFolder, scenarioId)
    if (found) return found
  }
  return null
}

function walkForScenario(folder: Folder | EnvironmentFolder | Scenario, scenarioId: string): Scenario | null {
  const items = 'items' in folder ? folder.items ?? [] : []
  for (const item of items) {
    if (isScenario(item) && item.id === scenarioId) return item
    if (isScenario(item)) {
      const inner = walkForScenario(item, scenarioId)
      if (inner) return inner
    } else if (isAnyFolder(item)) {
      const inner = walkForScenario(item, scenarioId)
      if (inner) return inner
    }
  }
  return null
}

/** Env-resolve the request's route using the parent env-folder's
 * first environment, so `{{baseUrl}}/...` becomes a literal URL the
 * matcher can regex against the operations. Path-params that aren't
 * in the env stay literal — `findOperationForRoute` handles that. */
function resolvedRouteFromRequest(request: Request, parent: EnvironmentFolder): RouteLike {
  const route = routeFromRequest(request)
  if (route.url === undefined) return route
  const env = parent.environments[0]
  if (!env) return route
  const flat: Record<string, string> = {}
  for (const kv of env.variables) {
    const v: unknown = kv.value
    if (typeof v === 'string') flat[kv.key] = v
    else if (typeof v === 'number' || typeof v === 'boolean') flat[kv.key] = String(v)
  }
  return { ...route, url: resolveUrlAgainstEnv(route.url, flattenEnvVars(flat)) }
}

export const SearchTooltipContent: React.FC<SearchTooltipContentProps> = ({ result }) => {
  const { t } = useTranslation()
  const { category, icon, id: resultId, title: resultTitle, metadata } = result
  const collections = useRestormStore((state) => state.collections)

  const restormMetadata = metadata as RestormSearchMetadata | undefined
  const notes = restormMetadata?.notes
  const breadcrumb = restormMetadata?.breadcrumb ?? []
  const ribbonBookmarks: Bookmark[] = useMemo(
    () => (restormMetadata?.tags ?? []).map((label) => ({ label })),
    [restormMetadata]
  )

  const requestDetailsMarkdown = useMemo(() => {
    if (!restormMetadata) return ''
    return compiledTemplate(restormMetadata)
  }, [restormMetadata])

  // Resolve the request → parent → apiDocumentation chain so we can
  // decide whether the popover surfaces structured docs.
  const docContent = useMemo<React.ReactNode | null>(() => {
    if (category === 'request') {
      const lookup = findRequestWithParent(collections, resultId)
      if (!lookup) return null
      const rawApiDoc = lookup.parent.apiDocumentation
      if (!rawApiDoc) return null
      const apiDoc = mergeEnumDefinitionsIntoModels(rawApiDoc, lookup.parent.enumDefinitions)
      const route = resolvedRouteFromRequest(lookup.request, lookup.parent)
      if (!findOperationForRoute(apiDoc, route)) return null
      return (
        <DocumentationHost
          apiDocumentation={apiDoc}
          filters={[route]}
          testId="search-tooltip-documentation-host"
        />
      )
    }
    if (category === 'folder') {
      const folder = findFolderInTree(collections, resultId)
      if (!folder) return null
      // Only env-folders carry structured `apiDocumentation`. Plain
      // folders without one fall through to the notes-only popover.
      if (!isEnvironmentFolder(folder)) return null
      const rawApiDoc = folder.apiDocumentation
      if (!rawApiDoc) return null
      const apiDoc = mergeEnumDefinitionsIntoModels(rawApiDoc, folder.enumDefinitions)
      return (
        <DocumentationHost
          apiDocumentation={apiDoc}
          scopeTitle={folder.name}
          showApiInfo
          testId="search-tooltip-documentation-host"
        />
      )
    }
    return null
  }, [category, collections, resultId])

  const Header = (
    <>
      {ribbonBookmarks.length > 0 && (
        <BookmarkRibbonStack
          bookmarks={ribbonBookmarks}
          editable={false}
          data-testid="search-bookmarks"
        />
      )}
      {breadcrumb.length > 0 && (
        <div className="search-tooltip-breadcrumb">
          {breadcrumb.map((item, index) => (
            <React.Fragment key={index}>
              {index > 0 && <span className="breadcrumb-separator">/</span>}
              <span className="breadcrumb-item">{item}</span>
            </React.Fragment>
          ))}
        </div>
      )}
    </>
  )

  // Structured-docs branch: keep only the bookmark + breadcrumb; the
  // method/title row and the rest of the legacy preview are dropped.
  // The DocumentationHost itself surfaces title + method + parameters
  // + responses + models in a much richer layout.
  //
  // Hard-cap the popover height so the tooltip positioning system
  // can compute a beak anchored to the source row — when the popover
  // is allowed to grow to natural content height (~1200px+ for a
  // route with many parameters / models), the beak math falls out of
  // alignment with the hovered element and the tooltip extends past
  // the viewport. `overflow: hidden` is required so the inner
  // `DocumentationHost`'s ScrollableElement gets a bounded parent
  // and can actually scroll instead of overflowing.
  //
  // The wheel handler stops propagation so the SearchBar's results
  // listview (which lives behind the popover) doesn't intercept the
  // event and `preventDefault` it before the inner ScrollableElement
  // can react — otherwise the user can't scroll the doc.
  if (docContent) {
    return (
      <div
        style={{
          position: 'relative',
          height: 'min(640px, calc(100vh - 90px))',
          maxHeight: 'calc(100vh - 90px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onWheelCapture={(e) => { e.stopPropagation() }}
        data-testid="search-tooltip-with-docs"
      >
        {Header}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {docContent}
        </div>
      </div>
    )
  }

  if (category === 'scenario') {
    // Scenario preview: same chrome as the request branch (bookmark
    // ribbon + breadcrumb + Badge + title), then a read-only React
    // Flow embed of the scenario's graph. Falls back to a notes-only
    // panel when the scenario id doesn't resolve to a live scenario
    // (stale index that hasn't been refreshed yet).
    const scenario = findScenarioInTree(collections, resultId)
    return (
      <div
        style={{
          position: 'relative',
          height: 'min(640px, calc(100vh - 90px))',
          maxHeight: 'calc(100vh - 90px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onWheelCapture={(e) => { e.stopPropagation() }}
        data-testid="search-tooltip-scenario"
      >
        {Header}
        <div style={{ marginBottom: 8, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge type="SCENARIO" />
          <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resultTitle}</strong>
        </div>
        {notes && (
          <div style={{ marginBottom: 8, flexShrink: 0 }}>
            <MarkdownViewer value={notes} style={{ maxHeight: '40vh' }} data-testid="markdown-viewer-scenario-notes" />
          </div>
        )}
        {scenario
          ? <div style={{ flex: 1, minHeight: 0 }}><ScenarioGraphPreview scenario={scenario} /></div>
          : <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.6 }}>{t('search.tooltip.noScenario', 'Scenario unavailable')}</div>}
      </div>
    )
  }

  if (category === 'request' && icon) {
    const method = icon.toUpperCase()
    const tabs: Tab[] = [
      {
        id: 'request',
        label: t('requestTab.tabs.requestLayout'),
        content: <MarkdownViewer value={requestDetailsMarkdown || t('search.tooltip.noDetails', 'No details available')} style={{ maxHeight: 'calc(100vh - 200px)' }} data-testid="markdown-viewer-request" />,
        useScrollableElement: false
      }
    ]
    if (notes) {
      tabs.push({
        id: 'notes',
        label: t('requestTab.tabs.notes'),
        content: <MarkdownViewer value={notes} style={{ maxHeight: 'calc(100vh - 200px)' }} data-testid="markdown-viewer-notes" />,
        useScrollableElement: false
      })
    }

    return (
      <div style={{ position: 'relative', maxHeight: 'calc(100vh - 90px)', display: 'flex', flexDirection: 'column' }}>
        {Header}
        <div style={{ marginBottom: 8, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge type={mapToBadgeType(method)} />
          <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resultTitle}</strong>
        </div>
        <Tabs tabs={tabs} data-testid="tabs-request-tooltip" />
      </div>
    )
  }

  // Folder / env-folder without structured docs — title + notes if any.
  const folderTabs: Tab[] = []
  if (notes) {
    folderTabs.push({
      id: 'notes',
      label: t('folderView.tabs.notes'),
      content: <MarkdownViewer value={notes} style={{ maxHeight: 'calc(100vh - 200px)' }} data-testid="markdown-viewer-notes" />,
      useScrollableElement: false
    })
  }

  return (
    <div style={{ position: 'relative', maxHeight: 'calc(100vh - 90px)', display: 'flex', flexDirection: 'column' }}>
      {Header}
      <div style={{ marginBottom: 8, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resultTitle}</strong>
      </div>
      {folderTabs.length > 0 ? (
        <Tabs tabs={folderTabs} data-testid="tabs-folder-tooltip" />
      ) : (
        <div style={{ color: 'var(--descriptionForeground)', fontStyle: 'italic' }}>
          {t('search.tooltip.noContent', 'No documentation or notes')}
        </div>
      )}
    </div>
  )
}
