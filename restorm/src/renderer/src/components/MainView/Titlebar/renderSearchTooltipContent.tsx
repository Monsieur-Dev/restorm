/**
 * Function to render tooltip content for search results
 */

import React from 'react'
import type { SearchResult } from 'electron-core-ui/renderer'
import { SearchTooltipContent } from './SearchTooltipContent'

/**
 * Function to render tooltip content, for use with SearchBar's renderTooltipContent prop
 */
export const renderSearchTooltipContent = (result: SearchResult): React.ReactNode => {
  return <SearchTooltipContent result={result} />
}
