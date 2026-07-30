# CodeEditor Component

## Overview

`CodeEditor` is a wrapper around Monaco (`@monaco-editor/react`) that:

- Synchronizes the Monaco theme with the app theme (`document.documentElement[data-theme]`) when `theme` is not provided.
- Supports a debounced `onChange` via `changeDebounceMs`.
- Adds a custom action "Go to definition" that extracts a Handlebars variable name from `{{variableName}}` at the cursor position and calls `onGoToDefinition(variableName)`.
- Optionally tolerates Handlebars syntax in an otherwise-validated document (`tolerateHandlebars`), so a template that is also a JSON/XML payload does not squiggle. See [Handlebars tolerance](#handlebars-tolerance).
- Colours the Handlebars constructs of such a document, including those nested in a quoted string, which no language tokenizer can reach. See [Handlebars colouring](#handlebars-colouring).

## Component location

- Source: `electron-core-ui/src/renderer/components/CodeEditor/CodeEditor.tsx`
- Styles: `electron-core-ui/src/renderer/components/CodeEditor/codeEditor.css`

## API

### Props

`CodeEditorProps` extends Monaco `EditorProps` (except `theme`) and adds:

- `theme?: string`: override Monaco theme. If omitted, `CodeEditor` auto-detects `vs` / `vs-dark` from `document.documentElement[data-theme]`.
- `changeDebounceMs?: number`: debounce delay (ms) before emitting `onChange`. Default: `200`. Use `0` to disable debounce.
- `onEditorMount?: OnMount`: alias of `onMount`.
- `onGoToDefinition?: (variableName: string) => void`: called when the user triggers "Go to definition" (Ctrl/Cmd+F12 by default) on a Handlebars variable `{{...}}`.
- `goToDefinitionLabel?: string`: label used in the editor action/context menu. By default it uses i18n key `codeEditor.goToDefinition`.
- `tolerateHandlebars?: boolean`: treat the document as a Handlebars template as well as a payload — template syntax stops producing error markers and is coloured. Default `false`. See [Handlebars tolerance](#handlebars-tolerance) and [Handlebars colouring](#handlebars-colouring).
- `data-testid?: string`: stable E2E hook applied to the root element.

### Ref

`CodeEditor` forwards a ref (`CodeEditorRef`) exposing:

- `editor`: Monaco editor instance
- `monaco`: Monaco namespace

## Handlebars tolerance

A field can legitimately hold a document that is BOTH a template and a
structured payload — a request body like
`{"id": {{petId}}, "raw": "{{{name}}}"}` is a valid Handlebars template. Monaco
validates JSON in a web worker that knows nothing about `{{ … }}`, so it reports
the template as broken and paints the payload red.

`tolerateHandlebars` fixes that without weakening validation: the worker still
runs, and the markers it publishes are pruned afterwards.

```tsx
<CodeEditor
  language="json"
  value={body}
  onChange={(v) => setBody(v ?? '')}
  tolerateHandlebars
/>
```

What it accepts:

- `{{var}}`, `{{helper arg}}`, including quoted arguments that contain `}}`
- `{{{var}}}` (triple-brace, unescaped)
- a `{{#if}} … {{/if}}` / `{{#each}} … {{/each}}` block whose two halves are on
  the SAME line — including the classic list prefix `[{{#each pets}}1,{{/each}}0]`
- a construct in a bare value position (`{"id": {{petId}}}`, so the type
  survives) as well as inside a string (`{"n": "Hi {{first}}"}`)

What it still reports:

- every syntax error that is not explained by the template — a missing value, a
  trailing comma, an unquoted key, a stray brace. Positions are unchanged,
  because the check masks each construct with a placeholder of the same width.
- an unterminated `{{`, which is a typo rather than a construct.

Two deliberate limits:

- **A block spanning several lines** (`{{#each}}` on one line, `{{/each}}` on
  another) cannot be masked into a single JSON value, so only the markers sitting
  ON its tags are dropped; errors the block induces elsewhere still squiggle.
- **Errors inside a construct are not reported** — between the braces the
  Handlebars grammar applies, and the JSON validator's opinion there is noise.

Only `json` / `jsonc` models get the mask-and-reparse pass; any other language
(e.g. `xml`, which Monaco ships without a validator) gets the
markers-on-the-construct filtering only.

Leave the prop off for any editor showing a document the user does NOT template:
a response body, a schema, a config file. Tolerance is opt-in per editor and
never changes Monaco's global defaults, so two editors in the same window can
disagree about it.

### Reusable helpers

The decision logic is pure text arithmetic, exported for consumers that need to
reason about the same spans (validation badges, a "resolve preview", tests):

- `findHandlebarsSpans(text, options?): HandlebarsSpan[]` — every construct as a
  `{ start, end, kind }` triple (`kind: 'expression' | 'block'`). A block whose
  two halves sit on one line is returned as ONE span covering its content, which
  is what masking needs; pass `{ mergeSameLineBlocks: false }` for its two tags
  on their own, which is what a caller interested in the SYNTAX needs.
- `maskHandlebarsForJson(text, spans?, variant?): string` — the same document with
  every construct replaced by a same-width JSON-legal placeholder.
- `isJsonValidIgnoringHandlebars(text, spans?): boolean` — would this parse if its
  constructs were plain values?
- `filterHandlebarsMarkers(text, markers, { languageId }): Marker[]` — the marker
  set to keep; accepts anything with Monaco's 1-based range fields.
- `findHandlebarsHighlightRanges(text): HandlebarsHighlightRange[]` — the same
  constructs as editor ranges (1-based line/column, end-exclusive), ready to hand
  to a decoration; blocks unmerged, so only the tags are covered.
- `HANDLEBARS_INLINE_CLASS` — the CSS class the colouring stamps on a construct,
  for a host stylesheet or a test that needs to name it.

## Handlebars colouring

`tolerateHandlebars` also gives the constructs their own colour, and the reason
it takes a decoration rather than a tokenizer is worth stating: Monaco colours
text through the model language's grammar, and neither candidate grammar can do
this job. To the JSON grammar, `"{{petId}}"` is a string and the construct inside
it is ordinary string text; swapping in a Handlebars grammar would colour it, but
then the payload is no longer validated as JSON at all.

Decorations are applied by RANGE, so they are language-agnostic. Every construct
`findHandlebarsSpans` reports gets an inline class on top of whatever the language
already painted — so a construct is coloured wherever it is excused from
validation, in a value position (`{"id": {{petId}}}`), inside a quoted string
(`{"petid": "{{petId}}"}`) and inside an XML element
(`<id>{{petId}}</id>`) alike.

The colour is `var(--hljs-variable)` — the palette entry every theme already
defines for a variable in highlighted code — so the constructs track the active
theme and no new theme variable is introduced. Override it for one host by
re-styling the class:

```css
.my-template-editor .monaco-editor .ecui-handlebars-construct {
  color: var(--my-template-colour);
}
```

A block's TAGS are coloured, not the payload they wrap: in
`[{{#each pets}}"{{this}}",{{/each}}]` the three tags light up and the `","`
between them stays string-coloured. The document is repainted on every content
change, including the imperative `setValue` an external `value` override goes
through.

## Testing

### Recommended stable hooks

If you pass `data-testid`:

- Root: `[data-testid="{id}"]`
- Monaco container: `[data-testid="{id}-monaco"]`

The root also exposes:

- `data-theme-source="auto|prop"`
- `data-resolved-theme="vs|vs-dark|..."`

### E2E helpers

`electron-core-ui/testing` exports selector helpers:

- `codeEditorRootSelector(testId)`
- `codeEditorMonacoContainerSelector(testId)`
- `codeEditorTextareaSelector(testId)`
- `codeEditorResolvedThemeAttrSelector(testId)`

### Playwright-BDD steps

`electron-core-ui/testing/playwright-bdd` exports `defineCodeEditorBddSteps(bdd)`.
It registers generic steps such as:

- `Then code editor {string} should be visible`
- `When I type in code editor {string} {string}`
- `Then code editor {string} resolved theme should be {string}`

## Offline / no-CDN guarantee

Importing `CodeEditor` from `electron-core-ui` runs a one-time
`bootstrapMonaco()` side-effect that:

- Calls `loader.config({ monaco })` so `@monaco-editor/react` uses
  the locally-bundled `monaco-editor` package instead of fetching
  Monaco from `cdn.jsdelivr.net` at first mount.
- Sets `self.MonacoEnvironment.getWorker(_, label)` to instantiate
  Vite-bundled `?worker` chunks for the `editor` / `json` / `css` /
  `html` / `typescript` workers, so Monaco never asks the network
  for its language services either.

This is automatic — consumers don't call `bootstrapMonaco()` directly.
The bootstrap is idempotent + module-scoped, so multiple `CodeEditor`
mounts share a single configuration.

If you write a new module that loads Monaco *without* going through
`CodeEditor` (rare; only relevant for direct `monaco.editor.create`
calls outside the wrapper), import the bootstrap explicitly:

```ts
import { bootstrapMonaco } from 'electron-core-ui'
bootstrapMonaco()
```
