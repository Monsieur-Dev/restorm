# ColorPicker Component

## Overview

`ColorPicker` is a thin wrapper around `@uiw/react-color` (Sketch picker) to provide a consistent API and theme integration with Electron Core UI.

## Component Location

- Source: `electron-core-ui/src/renderer/components/ColorPicker/ColorPicker.tsx`
- Types: `electron-core-ui/src/renderer/components/ColorPicker/types.ts`
- Styles: `electron-core-ui/src/renderer/components/ColorPicker/colorPicker.css`

## Props

```ts
export interface ColorPickerProps {
  value: string
  onChange: (nextHex: string) => void
  disableAlpha?: boolean
  className?: string
  style?: React.CSSProperties
}
```

## Theme integration

The wrapper maps `@uiw/react-color` styles to application tokens via CSS variables:

- `--editor-background`, `--editor-foreground`
- `--input-background`, `--input-foreground`, `--input-border`
- `--panel-border`, `--focusBorder`

The mapping is implemented in `colorPicker.css` and scoped under `.ecu-color-picker` to avoid impacting other instances.

## Usage

```tsx
import React, { useState } from 'react'
import { ColorPicker } from 'electron-core-ui/renderer'

export function Example(): JSX.Element {
  const [color, setColor] = useState('#ff00aa')

  return (
    <ColorPicker
      value={color}
      onChange={setColor}
      disableAlpha
    />
  )
}
```

