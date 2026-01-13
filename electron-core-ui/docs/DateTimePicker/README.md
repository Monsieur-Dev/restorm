# DateTimePicker Component

## Overview

`DateTimePicker` is a small composite component built on top of `InputBox` and `Tooltip`.
It displays the selected `Date` as `Date.toString()` in a non-editable input and provides a clock button
to open a calendar popover for selection.

## Component Location

- Source: `electron-core-ui/src/renderer/components/DateTimePicker/DateTimePicker.tsx`
- Types: `electron-core-ui/src/renderer/components/DateTimePicker/types.ts`
- Styles: `electron-core-ui/src/renderer/components/DateTimePicker/dateTimePicker.css`

## Props

```ts
export interface DateTimePickerProps {
  value: Date | null
  onChange: (next: Date) => void
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
  inputOptions?: Partial<IInputOptions>
}
```

## Usage

```tsx
import React, { useState } from 'react'
import { DateTimePicker } from 'electron-core-ui/renderer'

export function Example(): JSX.Element {
  const [date, setDate] = useState<Date | null>(new Date())

  return <DateTimePicker value={date} onChange={setDate} />
}
```

