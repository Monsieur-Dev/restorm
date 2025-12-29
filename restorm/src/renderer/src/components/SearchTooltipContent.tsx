/**
 * SearchTooltipContent - Custom tooltip content for search results in restorm
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Handlebars from 'handlebars'
import { MarkdownViewer, Tabs, type Tab, type SearchResult } from 'electron-core-ui/renderer'
import type { RestormSearchMetadata } from '../services/SearchIndexService'
import requestDetailsTemplate from '../resources/templates/search/request-details.hbs?raw'
import { Badge } from './Badge'
import { mapToBadgeType } from '../utils/badgeUtils'
import './SearchTooltipContent.css'

// Compile the Handlebars template
const compiledTemplate = Handlebars.compile(requestDetailsTemplate)

// Register Handlebars helper for equality check
Handlebars.registerHelper('ifEquals', function (this: unknown, arg1: unknown, arg2: unknown, options: Handlebars.HelperOptions) {
  return arg1 === arg2 ? options.fn(this) : options.inverse(this)
})

interface SearchTooltipContentProps {
  result: SearchResult
}

/**
 * Renders the tooltip content for a search result with tabs for Request, Documentation, and Notes
 */
export const SearchTooltipContent: React.FC<SearchTooltipContentProps> = ({ result }) => {
  const { t } = useTranslation()
  const { category, icon, title: resultTitle, description, metadata } = result
  
  // Cast metadata to our restorm-specific type
  const restormMetadata = metadata as RestormSearchMetadata | undefined

  // Generate request details markdown from metadata
  const requestDetailsMarkdown = useMemo(() => {
    if (!restormMetadata) return ''
    return compiledTemplate(restormMetadata)
  }, [restormMetadata])

  if (category === 'request' && icon) {
    const method = icon.toUpperCase()
    const tags = restormMetadata?.tags ?? []
    const notes = restormMetadata?.notes
    const breadcrumb = restormMetadata?.breadcrumb ?? []

    // Build tabs for request tooltip - order matters (first tab is default)
    const tabs: Tab[] = []
    
    // Show Documentation tab first if description exists (default tab)
    if (description) {
      tabs.push({
        id: 'documentation',
        label: t('requestTab.tabs.docs'),
        content: <MarkdownViewer value={description} style={{ maxHeight: 'calc(100vh - 200px)' }} />,
        useScrollableElement: false
      })
    }
    
    // Request tab
    tabs.push({
      id: 'request',
      label: t('requestTab.tabs.requestLayout'),
      content: <MarkdownViewer value={requestDetailsMarkdown || t('search.tooltip.noDetails', 'No details available')} style={{ maxHeight: 'calc(100vh - 200px)' }} />,
      useScrollableElement: false
    })
    
    // Show Notes tab only if notes exist
    if (notes) {
      tabs.push({
        id: 'notes',
        label: t('requestTab.tabs.notes'),
        content: <MarkdownViewer value={notes} style={{ maxHeight: 'calc(100vh - 200px)' }} />,
        useScrollableElement: false
      })
    }

    return (
      <div style={{ maxHeight: 'calc(100vh - 90px)', display: 'flex', flexDirection: 'column' }}>
        {/* Breadcrumb */}
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
        {/* Method, title and tags on same line */}
        <div style={{ marginBottom: 8, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge type={mapToBadgeType(method)} />
          <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resultTitle}</strong>
          {tags.length > 0 && (
            <div className="search-tooltip-tags">
              {tags.map((tag, index) => (
                <span key={index} className="tag-badge">{tag}</span>
              ))}
            </div>
          )}
        </div>
        {/* Tabs - first tab in array is selected by default */}
        <Tabs tabs={tabs} />
      </div>
    )
  }

  // Folder or other category
  const folderTags = restormMetadata?.tags ?? []
  const folderNotes = restormMetadata?.notes
  const folderBreadcrumb = restormMetadata?.breadcrumb ?? []
  
  // Build tabs for folder tooltip - order matters (first tab is default)
  const folderTabs: Tab[] = []
  
  // Documentation first if exists (default tab)
  if (description) {
    folderTabs.push({
      id: 'documentation',
      label: t('folderView.tabs.docs'),
      content: <MarkdownViewer value={description} style={{ maxHeight: 'calc(100vh - 200px)' }} />,
      useScrollableElement: false
    })
  }
  
  if (folderNotes) {
    folderTabs.push({
      id: 'notes',
      label: t('folderView.tabs.notes'),
      content: <MarkdownViewer value={folderNotes} style={{ maxHeight: 'calc(100vh - 200px)' }} />,
      useScrollableElement: false
    })
  }

  return (
    <div style={{ maxHeight: 'calc(100vh - 90px)', display: 'flex', flexDirection: 'column' }}>
      {/* Breadcrumb */}
      {folderBreadcrumb.length > 0 && (
        <div className="search-tooltip-breadcrumb">
          {folderBreadcrumb.map((item, index) => (
            <React.Fragment key={index}>
              {index > 0 && <span className="breadcrumb-separator">/</span>}
              <span className="breadcrumb-item">{item}</span>
            </React.Fragment>
          ))}
        </div>
      )}
      {/* Title and tags on same line */}
      <div style={{ marginBottom: 8, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resultTitle}</strong>
        {folderTags.length > 0 && (
          <div className="search-tooltip-tags">
            {folderTags.map((tag, index) => (
              <span key={index} className="tag-badge">{tag}</span>
            ))}
          </div>
        )}
      </div>
      {/* Content with tabs or direct display */}
      {folderTabs.length > 0 ? (
        <Tabs tabs={folderTabs} />
      ) : (
        <div style={{ color: 'var(--descriptionForeground)', fontStyle: 'italic' }}>
          {t('search.tooltip.noContent', 'No documentation or notes')}
        </div>
      )}
    </div>
  )
}
