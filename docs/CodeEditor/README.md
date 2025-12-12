# CodeEditor Component

A Monaco Editor wrapper that automatically synchronizes with the application theme.

## Overview

The `CodeEditor` component encapsulates Monaco Editor from `@monaco-editor/react` and provides automatic theme switching based on the application's current theme. It detects changes to the `data-theme` attribute on `document.documentElement` and automatically switches between `vs-dark` and `vs` themes.

## Installation

The component is part of `electron-core-ui`. Import it from the renderer module:

```typescript
import { CodeEditor } from 'electron-core-ui/renderer'
```

## Props

The component accepts all props from `@monaco-editor/react`'s `Editor` component, plus:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `theme` | `string` | Auto-detected | Override the automatic theme detection. If not provided, the theme is determined from the `data-theme` attribute. |
| `onEditorMount` | `OnMount` | - | Alias for `onMount` callback. Called when the editor is mounted. |

### Inherited Props (from Monaco Editor)

| Prop | Type | Description |
|------|------|-------------|
| `value` | `string` | The editor content |
| `defaultValue` | `string` | Initial content (uncontrolled) |
| `language` | `string` | Language mode (e.g., 'typescript', 'json', 'javascript') |
| `height` | `string \| number` | Editor height |
| `width` | `string \| number` | Editor width |
| `options` | `IStandaloneEditorConstructionOptions` | Monaco editor options |
| `onChange` | `(value: string \| undefined) => void` | Called when content changes |
| `onMount` | `(editor, monaco) => void` | Called when editor is mounted |
| `loading` | `ReactNode` | Custom loading component |
| `path` | `string` | Unique path for the model (useful for multiple editors) |

## Usage Examples

### Basic Usage (Auto Theme)

```tsx
import { CodeEditor } from 'electron-core-ui/renderer'

function MyComponent() {
  const [code, setCode] = useState('')

  return (
    <CodeEditor
      value={code}
      language="typescript"
      height="400px"
      onChange={(value) => setCode(value ?? '')}
    />
  )
}
```

### Read-Only JSON Viewer

```tsx
<CodeEditor
  value={JSON.stringify(data, null, 2)}
  language="json"
  height="100%"
  options={{
    readOnly: true,
    minimap: { enabled: false },
    wordWrap: 'on',
    scrollBeyondLastLine: false
  }}
/>
```

### With Custom Options

```tsx
<CodeEditor
  value={code}
  language="javascript"
  height="500px"
  options={{
    minimap: { enabled: false },
    lineNumbers: 'on',
    automaticLayout: true,
    fontSize: 14,
    tabSize: 2
  }}
  onChange={(value) => setCode(value ?? '')}
/>
```

### Override Theme Manually

```tsx
<CodeEditor
  value={code}
  language="typescript"
  theme="hc-black"  // Force high contrast theme
  height="400px"
/>
```

### Accessing Editor Instance

```tsx
import { useRef } from 'react'
import { CodeEditor, type CodeEditorRef } from 'electron-core-ui/renderer'

function MyComponent() {
  const editorRef = useRef<CodeEditorRef>(null)

  const formatCode = () => {
    editorRef.current?.editor?.getAction('editor.action.formatDocument')?.run()
  }

  return (
    <>
      <button onClick={formatCode}>Format</button>
      <CodeEditor
        ref={editorRef}
        value={code}
        language="typescript"
        height="400px"
      />
    </>
  )
}
```

## Theme Detection

The component automatically detects the current theme by reading the `data-theme` attribute from `document.documentElement`. It maps theme values as follows:

| data-theme value | Monaco theme |
|------------------|--------------|
| `dark` | `vs-dark` |
| `hcDark` | `vs-dark` |
| `hc` | `vs-dark` |
| `light` | `vs` |
| `hcLight` | `vs` |
| (any other) | `vs` |

The component listens for changes to the `data-theme` attribute using a MutationObserver, so it will automatically update when the application theme changes.

## Migration from Direct Monaco Usage

If you're currently using Monaco Editor directly:

```tsx
// Before
import Editor from '@monaco-editor/react'

<Editor
  value={code}
  language="json"
  theme={isDarkTheme ? 'vs-dark' : 'vs'}
  height="100%"
  options={{ minimap: { enabled: false } }}
/>
```

Replace with:

```tsx
// After
import { CodeEditor } from 'electron-core-ui/renderer'

<CodeEditor
  value={code}
  language="json"
  height="100%"
  options={{ minimap: { enabled: false } }}
/>
```

Note: You can remove the manual theme detection logic since `CodeEditor` handles it automatically.

## TypeScript Types

```typescript
import type { CodeEditorProps, CodeEditorRef } from 'electron-core-ui/renderer'
```

### CodeEditorProps

Extends Monaco Editor's `EditorProps` with:

```typescript
interface CodeEditorProps extends Omit<EditorProps, 'theme'> {
  theme?: string
  onEditorMount?: OnMount
}
```

### CodeEditorRef

```typescript
interface CodeEditorRef {
  editor: monacoEditor.editor.IStandaloneCodeEditor | null
  monaco: Monaco | null
}
```



