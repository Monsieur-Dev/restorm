import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ScrollableElement } from 'electron-core-ui/renderer'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { Badge } from '../common/Badge'
import { mapToBadgeType } from '../../utils/badgeUtils'
import type {
  ModelDocumentation,
  OperationDocumentation
} from '../../../../shared/types/apiDocumentation'
import type { EnumGroup } from './enumGroups'
import { useDocumentationNavigation } from './documentationNavigation'

export interface DocumentationSidebarProps {
  /** Operations rendered in the host, in display order. */
  operations: OperationDocumentation[]
  /** Object models rendered in the host (deduplicated transitive
   * closure, enum schemas excluded — those live in `enumGroups`). */
  models: ModelDocumentation[]
  /** Enum groups (property-level + top-level enum schemas), collected
   * once by the host so the sidebar + Enums section stay in sync. */
  enumGroups: EnumGroup[]
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
  enumGroups,
  operationSlug,
  scopeTitle
}) => {
  const { t } = useTranslation()
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
      aria-label={t('documentation.sidebar.outline')}
    >
      <ScrollableElement
        className="documentation-host-sidebar__scroll"
        data-testid="documentation-host-sidebar-scroll"
        options={{ horizontal: 'hidden' }}
      >
      {scopeTitle !== undefined && scopeTitle.length > 0 && (
        <nav
          className="documentation-host-sidebar__section documentation-host-sidebar__section--top"
          aria-label={t('documentation.sections.overview')}
        >
          <Button
            className="documentation-host-sidebar__overview-link"
            onClick={(): void => { nav?.scrollToTop() }}
            data-testid="documentation-host-sidebar-overview"
          >
            <span className="documentation-host-sidebar__overview-name">{scopeTitle}</span>
            <span className="documentation-host-sidebar__overview-hint">{t('documentation.sections.overview')}</span>
          </Button>
        </nav>
      )}
      {groups.length > 0 && (
        <nav
          className="documentation-host-sidebar__section"
          aria-label={t('documentation.sections.operations')}
        >
          <Button
            className="documentation-host-sidebar__section-title documentation-host-sidebar__section-title--button"
            onClick={(): void => { nav?.scrollToOperations() }}
            data-testid="documentation-host-sidebar-section-operations"
          >
            {t('documentation.sections.operations')}
          </Button>
          <ul className="documentation-host-sidebar__group-list">
            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.name)
              return (
                <li key={group.name} className="documentation-host-sidebar__group">
                  <Button
                    className="documentation-host-sidebar__group-header"
                    aria-expanded={!isCollapsed}
                    onClick={(): void => { toggle(group.name) }}
                    data-testid={`documentation-host-sidebar-group-${group.name}`}
                  >
                    <span
                      className={`documentation-host-sidebar__caret codicon codicon-${isCollapsed ? 'chevron-right' : 'chevron-down'}`}
                      aria-hidden="true"
                    />
                    <span className="documentation-host-sidebar__group-name">{group.name}</span>
                  </Button>
                  {!isCollapsed && (
                    <ul className="documentation-host-sidebar__op-list">
                      {group.operations.map((op) => {
                        const slug = operationSlug(op)
                        const summary = op.summary ?? op.operationId ?? op.match.urlPattern
                        const method = op.match.method?.toUpperCase()
                        return (
                          <li key={slug} className="documentation-host-sidebar__op-item">
                            <HeaderHoverTooltip label={summary}>
                              <Button
                                className="documentation-host-sidebar__op-link"
                                onClick={(): void => { nav?.scrollToOperation(slug) }}
                                data-testid={`documentation-host-sidebar-op-${slug}`}
                                options={{ ariaLabel: summary }}
                              >
                                {method !== undefined && method.length > 0 && (
                                  <Badge type={mapToBadgeType(method)} />
                                )}
                                <span className="documentation-host-sidebar__op-summary">{summary}</span>
                              </Button>
                            </HeaderHoverTooltip>
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
          aria-label={t('documentation.sections.models')}
        >
          <Button
            className="documentation-host-sidebar__section-title documentation-host-sidebar__section-title--button"
            onClick={(): void => {
              const first = models[0]
              if (first) nav?.scrollToModel(first.name)
            }}
            data-testid="documentation-host-sidebar-section-models"
          >
            {t('documentation.sections.models')}
          </Button>
          <ul className="documentation-host-sidebar__model-list">
            {models.map((model) => (
              <li key={model.name} className="documentation-host-sidebar__model-item">
                <Button
                  className="documentation-host-sidebar__model-link"
                  onClick={(): void => { nav?.scrollToModel(model.name) }}
                  data-testid={`documentation-host-sidebar-model-${model.name}`}
                >
                  {model.name}
                </Button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {enumGroups.length > 0 && (
        <nav
          className="documentation-host-sidebar__section"
          aria-label={t('documentation.sections.enums')}
        >
          <Button
            className="documentation-host-sidebar__section-title documentation-host-sidebar__section-title--button"
            onClick={(): void => {
              const first = enumGroups[0]
              if (first) nav?.scrollToEnum(first.modelName)
            }}
            data-testid="documentation-host-sidebar-section-enums"
          >
            {t('documentation.sections.enums')}
          </Button>
          <ul className="documentation-host-sidebar__enum-list">
            {enumGroups.map((group) => (
              <li key={group.modelName} className="documentation-host-sidebar__enum-group">
                <Button
                  className="documentation-host-sidebar__enum-model"
                  onClick={(): void => { nav?.scrollToEnum(group.modelName) }}
                  data-testid={`documentation-host-sidebar-enum-${group.modelName}`}
                >
                  {group.modelName}
                </Button>
                <ul className="documentation-host-sidebar__enum-prop-list">
                  {group.entries.map((entry) => (
                    <li
                      key={entry.propertyName}
                      className="documentation-host-sidebar__enum-prop-item"
                    >
                      <HeaderHoverTooltip label={`${group.modelName}.${entry.propertyName}`}>
                        <Button
                          className="documentation-host-sidebar__enum-prop-link"
                          onClick={(): void => { nav?.scrollToEnum(group.modelName, entry.propertyName) }}
                          data-testid={`documentation-host-sidebar-enum-${group.modelName}-${entry.propertyName}`}
                          options={{ ariaLabel: `${group.modelName}.${entry.propertyName}` }}
                        >
                          {entry.propertyName}
                        </Button>
                      </HeaderHoverTooltip>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </nav>
      )}
      </ScrollableElement>
    </aside>
  )
}
