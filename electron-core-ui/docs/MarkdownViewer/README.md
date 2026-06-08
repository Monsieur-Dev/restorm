# MarkdownViewer

`MarkdownViewer` is a read-only Markdown renderer with optional Mermaid support.

## Props

- `value: string`: Markdown content to render.
- `allowMermaid?: boolean` (default: `true`): enables rendering of fenced code blocks with language `mermaid`.
- `compact?: boolean` (default: `false`): tightens block margins/padding — for rendering a small snippet (e.g. a single code block) inline, without the document-style spacing.
- `data-testid?: string`: optional test id applied to the root.
- `className?: string`: optional CSS class on the root container.

The syntax-highlight base text colour follows the active editor theme (so code is legible on both light and dark backgrounds).

## Behavior

- Uses `react-markdown` + `remark-gfm` for Markdown rendering.
- Converts `mermaid` code blocks into diagrams via Mermaid.
- Detects dark mode via `document.documentElement.dataset.theme` to configure Mermaid theme.
- Opens HTTP/HTTPS links in the external browser (`window.open`) without navigating inside the app.

## Usage example

```tsx
import { MarkdownViewer } from 'electron-core-ui/renderer'

<MarkdownViewer
  value={"# Title\n\n```mermaid\nclassDiagram\n  class User {\n    + id : integer\n  }\n```"}
/>
```

## Testing

When `data-testid` is provided, the component exposes stable hooks for E2E tests.

### `data-testid` conventions

- Root: `{id}`
- Code blocks (indexed): `{id}-codeblock-{index}`
- Copy button: `{id}-codeblock-{index}-copy`
- Mermaid blocks (indexed): `{id}-mermaid-{index}`
- HTTP(S) links (indexed): `{id}-link-{index}`

### Stable data attributes

- On the root:
  - `data-allow-mermaid`: `true | false`
  - `data-is-dark`: `true | false`
- On the copy button:
  - `data-is-copied`: `true | false`
- On the Mermaid block:
  - `data-is-rendered`: `true | false`

### Selectors (`electron-core-ui/testing`)

- `markdownViewerRootSelector(testId)`
- `markdownViewerCodeBlockSelector(testId, index)`
- `markdownViewerCodeBlockCopySelector(testId, index)`
- `markdownViewerMermaidSelector(testId, index)`
- `markdownViewerLinkSelector(testId, index)`

### Playwright-BDD steps (`electron-core-ui/testing/playwright-bdd`)

- `Then markdown viewer {string} should be visible`
- `Then markdown viewer {string} should be dark`
- `Then markdown viewer {string} allow mermaid should be {string}`
- `Then markdown viewer {string} should contain text {string}`
- `When I click markdown viewer {string} code block {int} copy`
- `Then markdown viewer {string} code block {int} copy should be copied`
- `Then markdown viewer {string} mermaid block {int} should be rendered`
- `When I click markdown viewer {string} link {int}`
- `Then a popup should open with url {string}`