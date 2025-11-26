# MonacoWorkbench Component

## Overview

The `MonacoWorkbench` component is a React wrapper that applies VSCode's base workbench styles to your entire application. It automatically detects the user's platform (macOS, Windows, Linux, or Web) and applies the appropriate fonts, styles, and CSS variables.

## Component Location

- Source: `electron-core-ui/src/renderer/components/MonacoWorkbench.tsx`
- Styles: `electron-core-ui/src/renderer/assets/monaco-workbench.css`
- Platform Hook: `electron-core-ui/src/renderer/hooks/usePlatform.ts`

## Features

- Automatic platform detection (macOS, Windows, Linux, Web)
- Platform-specific fonts and monospace variables
- VSCode workbench global styles
- CJK language font support (Chinese, Japanese, Korean)
- Optional window border
- Optional fullscreen mode
- macOS font aliasing control (auto, antialiased, none)
- Focus indication styles
- Placeholder colors
- Input and textarea styling

## Platform Detection

The component uses the `usePlatform` hook which:

1. **For Electron**: Detects via `process.platform`
   - `darwin` → `mac`
   - `win32` → `windows`
   - `linux` → `linux`

2. **For Web**: Fallback to `web` if `process` is unavailable or uses userAgent detection

## TypeScript Interface

```typescript
interface MonacoWorkbenchProps {
  children: React.ReactNode
  className?: string           // Additional CSS classes
  border?: boolean            // Apply window border
  fullscreen?: boolean        // Fullscreen mode
  fontAliasing?: 'auto' | 'antialiased' | 'none'  // macOS font smoothing
}
```

## Usage

### Basic Usage

```tsx
import { MonacoWorkbench } from 'electron-core-ui/renderer'

function App() {
  return (
    <MonacoWorkbench>
      <YourAppContent />
    </MonacoWorkbench>
  )
}
```

### With Font Aliasing (macOS)

```tsx
<MonacoWorkbench fontAliasing="antialiased">
  <YourAppContent />
</MonacoWorkbench>
```

### With Border

```tsx
<MonacoWorkbench border={true}>
  <YourAppContent />
</MonacoWorkbench>
```

### With Additional Classes

```tsx
<MonacoWorkbench className="my-custom-class">
  <YourAppContent />
</MonacoWorkbench>
```

### Complete Example

```tsx
import React from 'react'
import { MonacoWorkbench } from 'electron-core-ui/renderer'

const App: React.FC = () => {
  return (
    <MonacoWorkbench 
      fontAliasing="auto"
      border={false}
      fullscreen={false}
    >
      <div>
        <h1>My VSCode-like Application</h1>
        <p>With automatic platform-specific styling!</p>
      </div>
    </MonacoWorkbench>
  )
}

export default App
```

## Applied CSS Classes

The component generates classes like:

- `monaco-workbench` - Base class
- `monaco-workbench mac` - On macOS
- `monaco-workbench windows` - On Windows
- `monaco-workbench linux` - On Linux
- `monaco-workbench web` - In browser
- `monaco-workbench border` - When border prop is true
- `monaco-workbench fullscreen` - When fullscreen prop is true
- `monaco-workbench mac monaco-font-aliasing-antialiased` - With font aliasing on macOS

## Platform-Specific Fonts

### macOS
- System: `-apple-system`, `BlinkMacSystemFont`
- Monospace: `SF Mono`, `Monaco`, `Menlo`, `Courier`
- CJK: `PingFang SC/TC`, `Hiragino Sans GB`, `Apple SD Gothic Neo`

### Windows
- System: `Segoe WPC`, `Segoe UI`
- Monospace: `Consolas`, `Courier New`
- CJK: `Microsoft YaHei`, `Microsoft Jhenghei`, `Yu Gothic UI`, `Malgun Gothic`

### Linux
- System: `system-ui`, `Ubuntu`, `Droid Sans`
- Monospace: `Ubuntu Mono`, `Liberation Mono`, `DejaVu Sans Mono`
- CJK: `Source Han Sans`

## Global Styles Applied

The component applies the following global styles to all child elements:

### Body
- Full height and width
- No margin/padding
- Overflow hidden
- User-select disabled
- 11px base font size

### Workbench Container
- 13px font size
- 1.4em line height
- Relative positioning
- Overflow hidden
- VSCode foreground color

### Form Elements
- Inherit color and font family
- Custom placeholder colors via `--vscode-input-placeholderForeground`
- Focus outline via `--vscode-focusBorder`
- Custom select dropdowns with chevron

### Links
- No underline by default
- Underline on hover for accessibility
- Inherit colors when active

### Labels
- Pointer cursor

### Images
- No border

## CSS Variables

The component expects VSCode theme CSS variables to be defined:

- `--vscode-foreground` - Text color
- `--vscode-input-placeholderForeground` - Placeholder text
- `--vscode-focusBorder` - Focus outline color
- `--vscode-toolbar-hoverBackground` - Hover states
- `--vscode-toolbar-activeBackground` - Active states
- `--window-border-color` - Window border (if enabled)
- `--monaco-monospace-font` - Set automatically per platform

## Font Aliasing Options (macOS only)

- `auto` (default): Antialiased on high DPI screens
- `antialiased`: Always use antialiasing
- `none`: Disable font smoothing

## Integration with Theme System

The MonacoWorkbench component works seamlessly with the theme system:

```tsx
import { MonacoWorkbench, useTheme } from 'electron-core-ui/renderer'

function App() {
  const { currentTheme } = useTheme()
  
  return (
    <MonacoWorkbench>
      {/* All theme CSS variables are automatically applied */}
      <YourContent />
    </MonacoWorkbench>
  )
}
```

## Best Practices

1. **Wrap your entire app**: Place MonacoWorkbench at the root level
2. **One wrapper per app**: Don't nest multiple MonacoWorkbench components
3. **Let it detect platform**: Don't try to override platform detection
4. **Use theme variables**: Leverage CSS variables for colors
5. **Font aliasing**: Use `auto` for best results on all displays

## Example DOM Structure

```html
<div class="monaco-workbench linux">
  <!-- Your app content -->
  <input placeholder="Example" />
  <button>Click me</button>
  <a href="#">Link</a>
</div>
```

## AI Assistant Usage Notes

When using this component:
1. Always wrap your root component with MonacoWorkbench
2. Platform detection is automatic - no configuration needed
3. Font aliasing is macOS-specific and ignored on other platforms
4. The component applies global styles to ensure consistency
5. All child elements inherit VSCode-like styling
6. Use CSS variables for colors to maintain theme compatibility

