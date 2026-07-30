# MarkdownViewer

`MarkdownViewer` is a read-only Markdown renderer with optional Mermaid support.

## Props

- `value: string`: Markdown content to render.
- `allowMermaid?: boolean` (default: `true`): enables rendering of fenced code blocks with language `mermaid`.
- `compact?: boolean` (default: `false`): tightens block margins/padding — for rendering a small snippet (e.g. a single code block) inline, without the document-style spacing.
- `inlineImagesOnly?: boolean` (default: `false`): render ONLY self-contained inline `data:` images; drop every image the renderer would otherwise have to fetch over the network. For contexts whose outbound traffic is firewalled or unavailable, where a remote image would hang, prompt, or leak a request rather than render (release notes, offline help). See *Images* below.
- `data-testid?: string`: optional test id applied to the root.
- `className?: string`: optional CSS class on the root container.

The syntax-highlight base text colour follows the active editor theme (so code is legible on both light and dark backgrounds).

## Behavior

- Uses `react-markdown` + `remark-gfm` for Markdown rendering.
- Converts `mermaid` code blocks into diagrams via Mermaid.
- Detects dark mode via `document.documentElement.dataset.theme` to configure Mermaid theme.
- Opens HTTP/HTTPS links in the external browser (`window.open`) without navigating inside the app.
- Renders inline raster `data:image/…` images — see *Images* below.

## Images

`react-markdown` strips every `data:` URL by default. This viewer permits an
inline **raster** `data:image/…` URI (`png`, `jpeg`, `gif`, `webp`, `avif`,
`bmp`) — and **only** on an `<img src>` — so self-contained images display
without any network fetch.

The element/attribute restriction is load-bearing. `urlTransform` runs for every
URL attribute `react-markdown` knows about, including `object[data]`,
`embed[src]` and `iframe[src]`; a `data:` URL on one of those loads as a
*document*, and since this viewer enables `rehypeRaw` (raw HTML passes through)
with no sanitiser, permitting one there would let authored markdown execute
script. `image/svg+xml` is deliberately off the allow-list for the same reason:
an SVG is a document, not just pixels. Everything that is not an `<img src>`
keeps `react-markdown`'s default transform, which drops all `data:` URLs.

With **`inlineImagesOnly`**, remote images are dropped instead of loaded. This is
enforced on the rendered tree, not by rewriting the markdown text, because by
then reference-style images (`![alt][ref]` with `[ref]: https://…` defined
elsewhere in the document) have already resolved into plain `img` nodes that a
regex over the source would never see. `<source>` is dropped wholesale — it
exists only to point `<picture>`/`<video>` at a remote `srcset`. Covered forms:
inline `![](https://…)`, all three reference styles, raw `<img>`,
protocol-relative URLs, and `<picture><source srcset>`.

The same mode drops `<video>`, `<audio>`, `<iframe>`, `<embed>`, `<object>` and
`<track>` outright — with raw HTML enabled, each loads a remote resource on its
own — and strips `style` from surviving images, since
`style="background-image:url(https://…)"` is a fetch the tag check would not
catch. So an image cannot be sized with an inline `style` in this mode.

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