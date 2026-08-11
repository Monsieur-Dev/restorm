# SearchBar Component

## Overview

`SearchBar` provides a compact search UI that opens an input and renders grouped results.
Results support hover tooltips and keyboard navigation.

## API

```ts
import type React from 'react'

export interface SearchBarProps {
  /** Title to display when search bar is closed */
  title?: string

  /**
   * Optional test id applied to the SearchBar root element.
   * Defaults to `search-bar`.
   */
  'data-testid'?: string

  /** Callback when a search result is clicked */
  onResultClick?: ((result: SearchResult) => void) | undefined

  /** Placeholder text for the search input */
  placeholder?: string

  /**
   * Optional search function override.
   * Useful for deterministic E2E tests.
   */
  searchFn?: (query: string) => Promise<GroupedResults[]>

  /** Custom renderer for tooltip content. If not provided, uses default rendering with description. */
  renderTooltipContent?: (result: SearchResult) => React.ReactNode

  /** Custom renderer for method/type badge. If not provided, uses default request-type-badge styling. */
  renderBadge?: (method: string) => React.ReactNode

  /** Categories whose result items render with the inline badge layout
   *  ([Badge] Title — breadcrumb on a single row) instead of the default
   *  [Icon] Title \n breadcrumb stacked layout. Defaults to `['request']`. */
  badgedCategories?: string[]

  /**
   * Delay in milliseconds before the result tooltip hides after the
   * pointer leaves it. Defaults to `300`. Increase it when the
   * tooltip hosts an interactive surface the user may drag (e.g. a
   * pannable canvas) so a brief excursion outside the bounds doesn't
   * dismiss the tooltip mid-interaction.
   */
  tooltipHideDelayMs?: number

  /**
   * Make result rows draggable. Return the `dataTransfer` payload to stamp
   * (a map of MIME type → string value) for a result, or `undefined` for a
   * non-draggable one. Lets a host feed a search result to the SAME drop
   * targets its tree / list rows use — e.g. return
   * `{ 'text/plain': id, 'application/x-listview-item': id }` so dropping a
   * result onto a scenario or the workbench behaves like dragging the matching
   * sidebar row. The component stays generic: it only stamps what the host
   * supplies and sets `effectAllowed = 'move'`.
   */
  getResultDragData?: (result: SearchResult) => Record<string, string> | undefined
}
```

## Dragging results

When `getResultDragData` is supplied, each result row becomes `draggable`. On
`dragStart` the component writes every `MIME → value` pair the callback returns
onto the event's `dataTransfer` and sets `effectAllowed = 'move'`. The host owns
the payload shape, so search-result drags can target the exact same drop
handlers as the host's tree items — the component knows nothing project-specific.

## Testing

### `data-testid` API

`SearchBar` exposes stable E2E hooks via `data-testid` (default: `search-bar`).
When `data-testid="my-search"` is provided:

- Root: `my-search`
  - attributes:
    - `data-is-open`: `true|false`
    - `data-query-length`: number
    - `data-results-count`: number (sum of all `group.items.length`)
    - `data-has-results`: `true|false`
- Closed trigger: `my-search-closed`
- Open box: `my-search-open`
- Internal `InputBox`: `my-search-inputbox`
- Internal `ScrollableElement`: `my-search-scrollable`
- Results container: `my-search-results`
- Tooltip: `my-search-tooltip`
- Tooltip `MarkdownViewer`: `my-search-tooltip-markdown`
- Group header (category):
  - `my-search-category-{categoryKey}`
  - attributes:
    - `data-category`: raw category string
    - `data-is-collapsed`: `true|false`
- Result item:
  - `my-search-result-{resultKey}`
  - attributes:
    - `data-result-id`: raw result id string
    - `data-category`: raw result category string

`categoryKey` and `resultKey` are normalized with:

- `trim()`
- `toLowerCase()`
- replace any non `[a-z0-9]` sequence with `-`
- trim leading/trailing `-`
- fallback to `unknown` when the result is empty

### Selectors (electron-core-ui/testing)

- `searchBarRootSelector(testId)`
- `searchBarClosedSelector(testId)`
- `searchBarOpenSelector(testId)`
- `searchBarInputBoxTestId(testId)`
- `searchBarInputSelector(testId)` (targets the `InputBox` input)
- `searchBarScrollableTestId(testId)`
- `searchBarResultsSelector(testId)`
- `searchBarCategorySelector(testId, categoryKey)`
- `searchBarResultSelector(testId, resultKey)`
- `searchBarTooltipSelector(testId)`
- `searchBarTooltipMarkdownSelector(testId)`

### Playwright-BDD steps (electron-core-ui/testing/playwright-bdd)

Register:

- `defineSearchBarBddSteps(bdd)`

Steps:

- `Then search bar {string} should be visible`
- `Then search bar {string} should be open`
- `Then search bar {string} should be closed`
- `When I open search bar {string}`
- `When I close search bar {string}`
- `When I type in search bar {string} query {string}`
- `When I type in search bar {string} query letter by letter {string}` (legacy alias)
- `When I clear search bar {string} query`
- `Then search bar {string} results count should be {int}`
- `Then search bar {string} results should be visible`
- `Then search bar {string} category {string} should be visible`
- `Then search bar {string} result {string} should be visible`
- `When I toggle search bar {string} category {string}`
- `When I click search bar {string} result {string}`
- `When I hover search bar {string} result {string}`
- `Then search bar {string} tooltip should be visible`
- `Then search bar {string} tooltip should be hidden`

