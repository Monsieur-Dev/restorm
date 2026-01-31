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
  'data-testid'?: string
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
      data-testid="colorpicker-main"
      value={color}
      onChange={setColor}
      disableAlpha
    />
  )
}
```

## Testing

### Recommended stable hooks

If you pass a `data-testid` to the component, you can target:

- Root: `[data-testid="..."]` (wrapper uses `.ecu-color-picker`)
- HEX input: `.w-color-editable-input input`
- Saturation area: `.w-color-saturation`
- Hue bar: `.w-color-hue`
- Alpha bar (when `disableAlpha={false}`): `.w-color-alpha`

The wrapper also exposes:

- `data-disable-alpha` (`"true"` or `"false"`)

### E2E helpers

`electron-core-ui/testing` exports selector helpers:

- `colorPickerTestIdSelector(testId)`
- `colorPickerRootSelector(testId)`
- `colorPickerHexInputSelector(testId)`
- `colorPickerSaturationSelector(testId)`
- `colorPickerHueSelector(testId)`
- `colorPickerAlphaSelector(testId)`

### Playwright-BDD steps

`electron-core-ui/testing/playwright-bdd` exports `defineColorPickerBddSteps(bdd)`.
It registers generic steps such as:

- `When I set color picker {string} hex to {string}`
- `When I click color picker {string} saturation at {int}% {int}%`
- `When I drag color picker {string} hue to {int}%`
- `Then color picker {string} hex input value should be {string}`

