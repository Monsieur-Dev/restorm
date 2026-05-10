# CodeEditor Component

## Overview

`CodeEditor` is a wrapper around Monaco (`@monaco-editor/react`) that:

- Synchronizes the Monaco theme with the app theme (`document.documentElement[data-theme]`) when `theme` is not provided.
- Supports a debounced `onChange` via `changeDebounceMs`.
- Adds a custom action "Go to definition" that extracts a Handlebars variable name from `{{variableName}}` at the cursor position and calls `onGoToDefinition(variableName)`.

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
- `data-testid?: string`: stable E2E hook applied to the root element.

### Ref

`CodeEditor` forwards a ref (`CodeEditorRef`) exposing:

- `editor`: Monaco editor instance
- `monaco`: Monaco namespace

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
