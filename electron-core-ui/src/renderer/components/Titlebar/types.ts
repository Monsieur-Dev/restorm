import type { SearchResult } from '../../services/SearchService'

export interface TitlebarProps {
  icon?: string | React.ReactNode
  title: string
  leftContent?: React.ReactNode
  rightContent?: React.ReactNode
  centerContent?: React.ReactNode
  children?: React.ReactNode  // Deprecated: use leftContent instead
  className?: string
  id?: string
  /** Show the search bar in the center instead of the title */
  showSearchBar?: boolean
  /** Callback when a search result is clicked */
  onSearchResultClick?: (result: SearchResult) => void
}
