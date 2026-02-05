import type { GroupedResults, SearchResult } from '../../services/SearchService'

export interface TitlebarProps {
  icon?: string | React.ReactNode
  title: string
  leftContent?: React.ReactNode
  rightContent?: React.ReactNode
  centerContent?: React.ReactNode
  children?: React.ReactNode  // Deprecated: use leftContent instead
  className?: string
  id?: string

  /**
   * Optional test id applied to the Titlebar root element.
   * When provided, internal test ids are derived for nested components unless overridden.
   */
  'data-testid'?: string

  /** Show the search bar in the center instead of the title */
  showSearchBar?: boolean
  /** Callback when a search result is clicked */
  onSearchResultClick?: (result: SearchResult) => void
  /** Custom renderer for search tooltip content */
  renderSearchTooltipContent?: (result: SearchResult) => React.ReactNode
  /** Custom renderer for method/type badge in search results */
  renderSearchBadge?: (method: string) => React.ReactNode

  /** Optional search function override for deterministic E2E tests. */
  searchFn?: (query: string) => Promise<GroupedResults[]>

  /** Optional test id for the internal SearchBar (when enabled). */
  searchBarTestId?: string

  /** Optional test id for the internal CustomWCO. */
  customWcoTestId?: string

  /**
   * Optional platform override passed to the internal CustomWCO.
   * Useful to make E2E harnesses deterministic in web environments.
   */
  customWcoPlatform?: string
}
