import React, { useMemo, useState } from 'react'
import { ScrollableElement } from 'electron-core-ui/renderer'
import type {
  ModelDocumentation,
  OperationDocumentation
} from '../../../../shared/types/apiDocumentation'
import { useDocumentationNavigation } from './documentationNavigation'

export interface DocumentationSidebarProps {
  /** Operations rendered in the host, in display order. */
  operations: OperationDocumentation[]
  /** Models rendered in the host (deduplicated transitive closure). */
  models: ModelDocumentation[]
  /** Stable slug fn for operation links, supplied by the host so
   * sidebar + route-block ids match exactly. */
  operationSlug: (op: OperationDocumentation) => string
  /** Set when the host renders its own scope header (env folder /
   * folder docs); the sidebar shows the matching "Overview" entry
   * at the top so the user can jump back to it from anywhere in
   * the document. */
  scopeTitle?: string
}

interface OperationGroup {
  name: string
  operations: OperationDocumentation[]
}

function groupOperations(operations: OperationDocumentation[]): OperationGroup[] {
  const order: string[] = []
  const map = new Map<string, OperationDocumentation[]>()
  for (const op of operations) {
    const key = op.group ?? '(ungrouped)'
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)?.push(op)
  }
  return order.map((name) => ({ name, operations: map.get(name) ?? [] }))
}

/**
 * Outline / TOC panel for the documentation host. Lists operations
 * grouped by tag (each group collapsible) and the deduplicated
 * model set; clicking either jumps to the corresponding section
 * via `useDocumentationNavigation`.
 *
 * The host hides the sidebar entirely when there is no operation
 * AND no model worth navigating to.
 */
export const DocumentationSidebar: React.FC<DocumentationSidebarProps> = ({
  operations,
  models,
  operationSlug,
  scopeTitle
}) => {
  const groups = useMemo(() => groupOperations(operations), [operations])
  const nav = useDocumentationNavigation()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const toggle = (groupName: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(groupName)) next.delete(groupName)
      else next.add(groupName)
      return next
    })
  }

  return (
    <aside
      className="documentation-host-sidebar"
      data-testid="documentation-host-sidebar"
      aria-label="Documentation outline"
    >
      <ScrollableElement
        className="documentation-host-sidebar__scroll"
        data-testid="documentation-host-sidebar-scroll"
      >
      {scopeTitle !== undefined && scopeTitle.length > 0 && (
        <nav
          className="documentation-host-sidebar__section documentation-host-sidebar__section--top"
          aria-label="Overview"
        >
          <button
            type="button"
            className="documentation-host-sidebar__overview-link"
            onClick={(): void => { nav?.scrollToTop() }}
            data-testid="documentation-host-sidebar-overview"
          >
            <span className="documentation-host-sidebar__overview-name">{scopeTitle}</span>
            <span className="documentation-host-sidebar__overview-hint">Overview</span>
          </button>
        </nav>
      )}
      {groups.length > 0 && (
        <nav
          className="documentation-host-sidebar__section"
          aria-label="Operations"
        >
          <div className="documentation-host-sidebar__section-title">Operations</div>
          <ul className="documentation-host-sidebar__group-list">
            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.name)
              return (
                <li key={group.name} className="documentation-host-sidebar__group">
                  <button
                    type="button"
                    className="documentation-host-sidebar__group-header"
                    aria-expanded={!isCollapsed}
                    onClick={(): void => { toggle(group.name) }}
                    data-testid={`documentation-host-sidebar-group-${group.name}`}
                  >
                    <span className="documentation-host-sidebar__caret" aria-hidden="true">
                      {isCollapsed ? '▸' : '▾'}
                    </span>
                    <span className="documentation-host-sidebar__group-name">{group.name}</span>
                    <span className="documentation-host-sidebar__group-count">
                      {String(group.operations.length)}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <ul className="documentation-host-sidebar__op-list">
                      {group.operations.map((op) => {
                        const slug = operationSlug(op)
                        const summary = op.summary ?? op.operationId ?? op.match.urlPattern
                        const method = op.match.method?.toUpperCase()
                        return (
                          <li key={slug} className="documentation-host-sidebar__op-item">
                            <button
                              type="button"
                              className="documentation-host-sidebar__op-link"
                              onClick={(): void => { nav?.scrollToOperation(slug) }}
                              data-testid={`documentation-host-sidebar-op-${slug}`}
                              title={summary}
                            >
                              {method !== undefined && method.length > 0 && (
                                <span
                                  className={`documentation-host-sidebar__method documentation-host-sidebar__method--${method.toLowerCase()}`}
                                >
                                  {method}
                                </span>
                              )}
                              <span className="documentation-host-sidebar__op-summary">{summary}</span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </nav>
      )}

      {models.length > 0 && (
        <nav
          className="documentation-host-sidebar__section"
          aria-label="Models"
        >
          <div className="documentation-host-sidebar__section-title">Models</div>
          <ul className="documentation-host-sidebar__model-list">
            {models.map((model) => (
              <li key={model.name} className="documentation-host-sidebar__model-item">
                <button
                  type="button"
                  className="documentation-host-sidebar__model-link"
                  onClick={(): void => { nav?.scrollToModel(model.name) }}
                  data-testid={`documentation-host-sidebar-model-${model.name}`}
                >
                  {model.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
      </ScrollableElement>
    </aside>
  )
}
