import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GroupedResults, SearchResult } from 'electron-core-ui/renderer'
import { SearchBar } from 'electron-core-ui/renderer'

const SearchBarE2ETab: React.FC = () => {
  const { t } = useTranslation()
  const [lastClicked, setLastClicked] = useState<string>('')

  const dataset = useMemo((): GroupedResults[] => ([
    {
      category: 'requests',
      label: t('searchBar.harness.categories.requests'),
      icon: 'globe',
      items: [
        {
          id: 'get-items',
          category: 'request',
          title: 'GET /items',
          score: 100,
          icon: 'get',
          description: 'Returns a list of items.\n\n```json\n{\n  \"ok\": true\n}\n```'
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
    },
    {
      category: 'docs',
      label: t('searchBar.harness.categories.docs'),
      icon: 'book',
      items: [
        {
          id: 'welcome-doc',
          category: 'doc',
          title: 'Welcome',
          score: 80,
          icon: 'file',
          description: 'This is **markdown** in a tooltip.'
        }
      ]
    }
  ]), [t])

  const searchFn = useCallback((query: string): Promise<GroupedResults[]> => {
    const q = query.trim().toLowerCase()
    if (!q) return Promise.resolve([])
    if (q === 'item' || q === 'items') return Promise.resolve(dataset)
    if (q === 'doc' || q === 'docs') {
      const docsGroup = dataset.find((g) => g.category === 'docs')
      return Promise.resolve(docsGroup ? [docsGroup] : [])
    }
    return Promise.resolve([])
  }, [dataset])

  const handleResultClick = useCallback((result: SearchResult): void => {
    setLastClicked(result.id)
  }, [])

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, height: '100%' }}>
      <div style={{ width: 520, minWidth: 520, height: '100%', borderRight: '1px solid var(--panel-border)', padding: 16 }}>
        <div style={{ marginBottom: 8 }}>
          {t('searchBar.harness.instructions')}
        </div>
        <SearchBar
          data-testid="searchbar"
          title={t('searchBar.harness.title')}
          placeholder={t('searchBar.harness.placeholder')}
          searchFn={searchFn}
          onResultClick={handleResultClick}
        />
        <div data-testid="searchbar-ready">true</div>
        <div data-testid="searchbar-last-clicked">{lastClicked}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: 16 }}>
        <div>
          {t('searchBar.harness.sidePanelTitle')}
        </div>
      </div>
    </div>
  )
}

export default SearchBarE2ETab
