import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { InputBox } from '../InputBox'
import { ScrollableElement } from '../ScrollableElement'
import { SettingItem } from './SettingItem'
import { useSettings } from '../../hooks/useSettings'
import type { SettingsGroup, SettingsGroupItem, SettingValue } from '../../../types/settings'
import { isSettingItem, isGroupItem } from '../../../types/settings'

export interface SettingsViewProps {
  'data-testid'?: string
}

// ---------- TOC helpers ----------

interface TocEntry {
  id: string
  path: string
  titleKey: string
  children: TocEntry[]
}

function buildTocEntries(groups: SettingsGroup[], parentPath: string[]): TocEntry[] {
  return groups.map(group => {
    const path = [...parentPath, group.id]
    const subgroups = group.items.filter(isGroupItem)
    return {
      id: group.id,
      path: path.join('.'),
      titleKey: group.titleKey,
      children: buildTocEntries(subgroups.map(sg => sg.group), path)
    }
  })
}

// ---------- TOC item renderer ----------

interface TocItemRendererProps {
  entry: TocEntry
  activeGroupPath: string | null
  expandedPaths: Set<string>
  visiblePaths: Set<string> | null
  onToggle: (path: string) => void
  onClick: (path: string) => void
  level: number
}

const TocItemRenderer: React.FC<TocItemRendererProps> = ({
  entry,
  activeGroupPath,
  expandedPaths,
  visiblePaths,
  onToggle,
  onClick,
  level
}) => {
  const { t } = useTranslation()

  // During search, hide groups that have no matching settings
  if (visiblePaths && !visiblePaths.has(entry.path)) return null

  const visibleChildren = visiblePaths
    ? entry.children.filter(c => visiblePaths.has(c.path))
    : entry.children
  const hasChildren = visibleChildren.length > 0
  const isExpanded = expandedPaths.has(entry.path)
  const isActive = activeGroupPath === entry.path

  return (
    <>
      <div
        className={`settings-toc-item${isActive ? ' settings-toc-item--active' : ''}`}
        style={{ paddingLeft: level * 16 + 8 }}
        onClick={() => { onClick(entry.path) }}
      >
        {hasChildren ? (
          <span
            className="settings-toc-expander"
            onClick={(e) => { e.stopPropagation(); onToggle(entry.path) }}
          >
            <i className={`codicon codicon-chevron-${isExpanded ? 'down' : 'right'}`} />
          </span>
        ) : (
          <span className="settings-toc-expander-placeholder" />
        )}
        <span className="settings-toc-label">{t(entry.titleKey)}</span>
      </div>
      {isExpanded && hasChildren && visibleChildren.map(child => (
        <TocItemRenderer
          key={child.path}
          entry={child}
          activeGroupPath={activeGroupPath}
          expandedPaths={expandedPaths}
          visiblePaths={visiblePaths}
          onToggle={onToggle}
          onClick={onClick}
          level={level + 1}
        />
      ))}
    </>
  )
}

// ---------- SettingsView ----------

export const SettingsView: React.FC<SettingsViewProps> = ({
  'data-testid': dataTestId
}) => {
  const { t } = useTranslation()
  const {
    groups,
    settings,
    isLoading,
    setSetting,
    resetSetting,
    searchQuery,
    setSearchQuery,
    filteredSettings
  } = useSettings()

  const rootTestId = dataTestId ?? 'settings-view'

  // TOC state
  const [activeGroupPath, setActiveGroupPath] = useState<string | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const activeGroupPathRef = useRef<string | null>(null)
  const groupElementsRef = useRef<Map<string, HTMLElement>>(new Map())
  const scrollContentRef = useRef<HTMLDivElement | null>(null)

  const tocEntries = useMemo(() => buildTocEntries(groups, []), [groups])

  // During search, only show TOC groups that contain matching settings
  const visibleTocPaths = useMemo(() => {
    if (!searchQuery) return null
    const paths = new Set<string>()
    for (const s of filteredSettings) {
      for (let i = 1; i <= s.groupPath.length; i++) {
        paths.add(s.groupPath.slice(0, i).join('.'))
      }
    }
    return paths
  }, [searchQuery, filteredSettings])

  // ---------- Setting handlers ----------

  const handleChange = useCallback((storageKey: string, value: SettingValue) => {
    void setSetting(storageKey, value)
  }, [setSetting])

  const handleReset = useCallback((storageKey: string) => {
    void resetSetting(storageKey)
  }, [resetSetting])

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
  }, [setSearchQuery])

  // ---------- Scroll sync: detect active group ----------

  const handleContentScroll = useCallback(() => {
    const scrollContainer = scrollContentRef.current
    if (!scrollContainer) return

    const scrollTop = scrollContainer.scrollTop
    let newActivePath: string | null = null
    let newActiveDepth = 0

    // Use layout position (offsetTop) combined with the sticky offset that
    // ScrollableElement computes and applies to each title via style.top.
    // A group is "active" when scrollTop reaches where its title becomes stuck.
    for (const [groupPath, el] of groupElementsRef.current.entries()) {
      // Walk up offsetParent chain to compute offset from scroll container
      let offsetFromContainer = 0
      let current: HTMLElement | null = el
      while (current && current !== scrollContainer) {
        offsetFromContainer += current.offsetTop
        current = current.offsetParent as HTMLElement | null
      }

      // Read the sticky top value computed by ScrollableElement for this title
      const titleEl = el.querySelector(':scope > .settings-group-title')
      const titleStyle = titleEl instanceof HTMLElement ? titleEl.style.top : ''
      const stickyTopRaw = parseFloat(titleStyle || '0')
      const stickyTop = Number.isFinite(stickyTopRaw) ? stickyTopRaw : 0

      if (scrollTop >= offsetFromContainer - stickyTop - 10) {
        const depth = groupPath.split('.').length
        if (depth > newActiveDepth) {
          newActivePath = groupPath
          newActiveDepth = depth
        } else if (depth === newActiveDepth) {
          newActivePath = groupPath
        }
      }
    }

    if (newActivePath !== activeGroupPathRef.current) {
      activeGroupPathRef.current = newActivePath
      setActiveGroupPath(newActivePath)

      // Auto-expand the active group path, collapse others
      if (newActivePath) {
        const parts = newActivePath.split('.')
        const newExpanded = new Set<string>()
        for (let i = 1; i <= parts.length; i++) {
          newExpanded.add(parts.slice(0, i).join('.'))
        }
        setExpandedPaths(newExpanded)
      }
    }
  }, [])

  // Trigger active group detection on initial render and when search results change
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      handleContentScroll()
    })
    return () => { cancelAnimationFrame(frame) }
  }, [handleContentScroll, filteredSettings])

  // ---------- TOC click: scroll to group ----------

  const handleTocClick = useCallback((groupPath: string) => {
    const el = groupElementsRef.current.get(groupPath)
    const scrollContainer = scrollContentRef.current
    if (!el || !scrollContainer) return

    // Compute the group's layout offset (unaffected by sticky positioning)
    let offsetFromContainer = 0
    let current: HTMLElement | null = el
    while (current && current !== scrollContainer) {
      offsetFromContainer += current.offsetTop
      current = current.offsetParent as HTMLElement | null
    }

    scrollContainer.scrollTo({ top: offsetFromContainer, behavior: 'smooth' })
  }, [])

  const handleTocToggle = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  // ---------- Right panel rendering ----------

  const filteredStorageKeys = new Set(filteredSettings.map(s => s.storageKey))

  const renderItem = (item: SettingsGroupItem, groupPath: string[]): React.ReactNode => {
    if (isSettingItem(item)) {
      const storageKey = [...groupPath, item.setting.id].join(':')
      const resolvedSetting = settings.get(storageKey) ?? filteredSettings.find(
        s => s.id === item.setting.id && s.groupPath.join('.') === groupPath.join('.')
      )

      if (!resolvedSetting) return null
      if (searchQuery && !filteredStorageKeys.has(resolvedSetting.storageKey)) return null

      return (
        <SettingItem
          key={resolvedSetting.storageKey}
          setting={resolvedSetting}
          value={resolvedSetting.currentValue}
          onChange={handleChange}
          onReset={handleReset}
        />
      )
    }

    if (isGroupItem(item)) {
      return renderGroup(item.group, groupPath)
    }

    return null
  }

  const renderGroup = (group: SettingsGroup, parentPath: string[]): React.ReactNode => {
    const currentPath = [...parentPath, group.id]
    const groupPathStr = currentPath.join('.')
    const depth = currentPath.length
    const HeadingTag = `h${Math.min(depth, 4)}` as 'h1' | 'h2' | 'h3' | 'h4'

    const renderedItems = group.items
      .map(item => renderItem(item, currentPath))
      .filter(Boolean)

    if (searchQuery && renderedItems.length === 0) return null

    return (
      <div
        key={groupPathStr}
        className="settings-group"
        data-testid={`settings-group-${group.id}`}
        ref={(el) => {
          if (el) {
            groupElementsRef.current.set(groupPathStr, el)
          } else {
            groupElementsRef.current.delete(groupPathStr)
          }
        }}
      >
        <HeadingTag className="settings-group-title" data-sticky-level={depth}>
          {t(group.titleKey)}
        </HeadingTag>
        <div className="settings-group-items">
          {renderedItems}
        </div>
      </div>
    )
  }

  // ---------- Render ----------

  if (isLoading) {
    return <div className="settings-view settings-view--loading" data-testid={rootTestId} />
  }

  const hasNoResults = !!searchQuery && filteredSettings.length === 0

  return (
    <div className="settings-view" data-testid={rootTestId}>
      <div className="settings-view-search">
        <InputBox
          options={{
            placeholder: t('settings.searchPlaceholder', 'Search settings...'),
            ariaLabel: t('settings.searchPlaceholder', 'Search settings...')
          }}
          value={searchQuery}
          onChange={handleSearchChange}
          data-testid={`${rootTestId}-search`}
        />
      </div>
      {hasNoResults ? (
        <div className="settings-view-no-results">
          {t('settings.noResults', 'No settings found.')}
        </div>
      ) : (
        <div className="settings-view-body">
          <div className="settings-view-toc">
            {tocEntries.map(entry => (
              <TocItemRenderer
                key={entry.path}
                entry={entry}
                activeGroupPath={activeGroupPath}
                expandedPaths={expandedPaths}
                visiblePaths={visibleTocPaths}
                onToggle={handleTocToggle}
                onClick={handleTocClick}
                level={0}
              />
            ))}
          </div>
          <ScrollableElement
            className="settings-view-scroll"
            onScroll={handleContentScroll}
            contentRef={scrollContentRef}
          >
            <div className="settings-view-content">
              {groups.map(group => renderGroup(group, []))}
            </div>
          </ScrollableElement>
        </div>
      )}
    </div>
  )
}
