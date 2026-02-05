# TagsView

`TagsView` displays and edits a list of tags (strings), typically used to annotate entities (folders, requests, etc.).

## Props

- `tags: string[]`: current tags.
- `onChange?: (tags: string[]) => void`: called on any change (add, rename, remove).
- `className?: string`: optional CSS class.
- `style?: React.CSSProperties`: optional inline styles.

## Behavior

- Renders tags in a single row, wrapping when needed.
- Click a tag: enters inline edit mode (similar UX to the last `Breadcrumb` segment).
- Right click a tag: opens a context menu with a remove action.
- `+` button (small/secondary) at the end to add a new tag.
- Uses theme variables:
  - `--tag-background`, `--tag-background-hover`, `--tag-foreground` (with fallbacks).

## Usage example

```tsx
import { TagsView } from 'electron-core-ui/renderer'

<TagsView
  tags={['user', 'admin']}
  onChange={(next) => setTags(next)}
/>
```

## Testing

### `data-testid` API

`TagsView` exposes stable test hooks via `data-testid`:

- Root: `data-testid` (default: `tagsview`)
  - attributes: `data-tag-count`, `data-editing-index`, `data-contextmenu-visible`
- List: `${testId}-list`
- Tag button: `${testId}-tag-${index}` (attributes: `data-is-editing`)
- Tag label: `${testId}-tag-${index}-label`
- Tag input (editing): `${testId}-tag-${index}-input`
- Add button: `${testId}-add`
- Context menu: `${testId}-contextmenu`

### Selectors (electron-core-ui/testing)

- `tagsViewRootSelector(testId)`
- `tagsViewListSelector(testId)`
- `tagsViewTagSelector(testId, index)`
- `tagsViewTagLabelSelector(testId, index)`
- `tagsViewTagInputSelector(testId, index)`
- `tagsViewAddSelector(testId)`
- `tagsViewContextMenuSelector(testId)`

### Playwright-BDD steps (electron-core-ui/testing/playwright-bdd)

Register:

- `defineTagsViewBddSteps(bdd)`
- `defineContextMenuBddSteps(bdd)` (used for the remove action)

Core steps:

- `Then tags view {string} should be visible`
- `Then tags view {string} should have {int} tags`
- `When I add a tag in tags view {string}`
- `When I start editing tag {int} in tags view {string}`
- `When I type {string} into tags view {string} tag {int} input`
- `When I type {string} into tags view {string} tag {int} input letter by letter` (legacy alias)
- `When I commit tags view {string} tag {int} editing`
- `When I blur tags view {string} tag {int} input`
- `When I cancel tags view {string} tag {int} editing`
- `When I open tags view {string} tag {int} context menu`
- `When I click tags view {string} remove tag menu item {string}`

### Typing policy

All steps that input text must type **letter-by-letter** (no `fill()` / no bulk input), to avoid missing key-driven behaviors.