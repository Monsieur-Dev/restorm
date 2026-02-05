import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GroupedResults, SearchResult } from 'electron-core-ui/renderer'
import { Titlebar } from 'electron-core-ui/renderer'

const TitlebarE2ETab: React.FC = () => {
  const { t } = useTranslation()
  const [showSearchBar, setShowSearchBar] = useState<boolean>(false)
  const [lastClicked, setLastClicked] = useState<string>('')

  const dataset = useMemo((): GroupedResults[] => ([
    {
      category: 'requests',
      label: t('titlebar.harness.categories.requests'),
      icon: 'globe',
      items: [
        {
          id: 'get-items',
          category: 'request',
          title: 'GET /items',
          score: 100,
          icon: 'get',
          description: 'Returns a list of items.'
        },
        {
          id: 'post-items',
          category: 'request',
          title: 'POST /items',
          score: 90,
          icon: 'post',
          description: 'Creates an item.'
        }
      ]
    }
  ]), [t])

  const searchFn = useCallback((query: string): Promise<GroupedResults[]> => {
    const q = query.trim().toLowerCase()
    if (!q) return Promise.resolve([])
    if (q === 'item' || q === 'items') return Promise.resolve(dataset)
    return Promise.resolve([])
  }, [dataset])

  const handleResultClick = useCallback((result: SearchResult): void => {
    setLastClicked(result.id)
  }, [])

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, height: '100%', flexDirection: 'column' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--panel-border)' }}>
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <input
            data-testid="titlebar-show-searchbar"
            type="checkbox"
            checked={showSearchBar}
            onChange={(e) => { setShowSearchBar(e.target.checked) }}
          />
          {t('titlebar.harness.showSearchBarLabel')}
        </label>
      </div>

      <Titlebar
        data-testid="titlebar-e2e"
        icon=""
        title={t('titlebar.harness.title')}
        showSearchBar={showSearchBar}
        searchFn={searchFn}
        customWcoPlatform="linux"
        onSearchResultClick={handleResultClick}
      />

      <div style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <div data-testid="titlebar-ready">true</div>
        <div data-testid="titlebar-last-clicked">{lastClicked}</div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
        {t('titlebar.harness.instructions')}
      </div>
    </div>
  )
}

export default TitlebarE2ETab
