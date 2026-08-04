import type { ListViewItemData } from 'electron-core-ui/renderer'
import { ScenarioTruncatedText } from './ScenarioTruncatedText'

/**
 * Decorate a `buildScenarioPathTree` tree so every row label clips with an
 * ellipsis at the row's real width and reveals its whole value on hover.
 *
 * The tree builder stays free of React/DOM (its ids are the JSON paths and its
 * labels are plain strings, which is what makes it unit-testable); the hover
 * behaviour is added here, at the rendering layer. A leaf whose label the
 * builder had to clip carries the untruncated text in `data.full`, which the
 * tooltip shows in preference to the clipped label.
 */
export function withValueTooltips(items: ListViewItemData[]): ListViewItemData[] {
  return items.map((item) => {
    const full = (item.data as { full?: string } | undefined)?.full
    return {
      ...item,
      ...(typeof item.title === 'string'
        ? { title: <ScenarioTruncatedText text={item.title} {...(full !== undefined ? { full } : {})} /> }
        : {}),
      ...(item.children ? { children: withValueTooltips(item.children) } : {})
    }
  })
}
