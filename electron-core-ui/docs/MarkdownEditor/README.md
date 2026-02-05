# MarkdownEditor

`MarkdownEditor` is a Markdown editor built on top of Milkdown (Crepe preset), designed for rich editing of documentation or notes.

## Props

- `initialValue?: string`: initial Markdown content shown in the editor.
- `data-testid?: string`: optional test id applied to the root.

## Behavior

- Uses Milkdown/Crepe to provide a WYSIWYG editing experience.
- Adapts automatically to the current theme via the `data-theme` attribute (`dark`, `hcDark`, etc.).
- Fills the available container space (100% width/height).

## Usage example

```tsx
import { MarkdownEditor } from 'electron-core-ui/renderer'

<MarkdownEditor initialValue={"# My doc"} />
```

## Testing

When `data-testid` is provided, the component exposes stable hooks for E2E tests.

### `data-testid` conventions

- Root: `{id}`
- Milkdown root wrapper: `{id}-root`
- Editor (contenteditable): `{id}-editor`

### Stable data attributes (on the root)

- `data-is-dark`: `true | false`
- `data-initial-length`: number

### Selectors (`electron-core-ui/testing`)

- `markdownEditorRootSelector(testId)`
- `markdownEditorMilkdownRootSelector(testId)`
- `markdownEditorContentEditableSelector(testId)`

### Playwright-BDD steps (`electron-core-ui/testing/playwright-bdd`)

- `Then markdown editor {string} should be visible`
- `Then markdown editor {string} should be dark`
- `When I focus markdown editor {string}`
- `When I type in markdown editor {string} {string}` (typed letter-by-letter)
- `Then markdown editor {string} should contain text {string}`