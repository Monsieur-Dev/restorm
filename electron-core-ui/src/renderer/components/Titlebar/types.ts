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
  /** Forwarded to the internal SearchBar as `badgedCategories` — extra
   * search categories whose items should render with the inline badge
   * layout instead of the default icon + stacked breadcrumb. Defaults
   * to `['request']` when omitted. */
  searchBadgedCategories?: string[]

  /** Optional search function override for deterministic E2E tests. */
  searchFn?: (query: string) => Promise<GroupedResults[]>

  /** Optional test id for the internal SearchBar (when enabled). */
  searchBarTestId?: string

  /** Forwarded to the internal SearchBar as `tooltipHideDelayMs` —
   * how long after the pointer leaves the result tooltip before it
   * hides. Defaults to 300ms when omitted. */
  searchTooltipHideDelayMs?: number

  /** Optional test id for the internal CustomWCO. */
  customWcoTestId?: string

  /**
   * Optional platform override passed to the internal CustomWCO.
   * Useful to make E2E harnesses deterministic in web environments.
   */
  customWcoPlatform?: string

  /** Show back/forward navigation buttons before the center zone */
  showNavigation?: boolean
}
