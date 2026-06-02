# DateTimePicker Component

## Overview

`DateTimePicker` is a small composite component built on top of `InputBox` and `Tooltip`.
It shows the selected `Date` formatted per the active output mode/pattern in an **editable** input, and
provides a clock button to open a calendar popover for selection. Typing a complete, valid date in the
input commits it through `onChange` (parsed with luxon to match the displayed format); an incomplete or
invalid entry is ignored until it becomes valid, so a mid-edit keystroke never commits a wrong value, and
the input shows a **red validation border** (`aria-invalid`) while the typed text isn't a parseable date
(an empty field stays neutral).

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

## Testing

### `data-testid` API

`DateTimePicker` exposes stable test hooks via `data-testid`:

- Root: `data-testid` (default: `datetimepicker`)
  - attributes: `data-is-open`, `data-disabled`, `data-output-mode`, `data-include-time`
- InputBox: `${id}-input`
- Trigger target: `${id}-target`
- Open button: `${id}-open`
- Tooltip popover (Tooltip root): `${id}-popover`
- Popover content root: `${id}-popover-content`
- Month navigation: `${id}-prev-month`, `${id}-next-month`, `${id}-month-label`
- Calendar day button: `${id}-day-YYYY-MM-DD` (attributes: `data-is-in-month`, `data-is-selected`)
- Include time checkbox: `${id}-include-time`
- Hours/minutes: `${id}-hours`, `${id}-minutes`
- Output mode select: `${id}-output-mode`
- Pattern input (`VariableInputBox`): `${id}-pattern`
- Preview value: `${id}-preview-value`

### Selectors (electron-core-ui/testing)

- `dateTimePickerRootSelector(testId)`
- `dateTimePickerInputSelector(testId)`
- `dateTimePickerOpenSelector(testId)`
- `dateTimePickerTargetSelector(testId)`
- `dateTimePickerPopoverSelector(testId)`
- `dateTimePickerPrevMonthSelector(testId)`
- `dateTimePickerNextMonthSelector(testId)`
- `dateTimePickerMonthLabelSelector(testId)`
- `dateTimePickerDaySelector(testId, isoDay)`
- `dateTimePickerIncludeTimeSelector(testId)`
- `dateTimePickerHoursSelector(testId)` / `dateTimePickerMinutesSelector(testId)`
- `dateTimePickerOutputModeSelector(testId)`
- `dateTimePickerPatternSelector(testId)`
- `dateTimePickerPreviewValueSelector(testId)`

### Playwright-BDD steps (electron-core-ui/testing/playwright-bdd)

Register:

- `defineDateTimePickerBddSteps(bdd)`
- `defineTooltipBddSteps(bdd)` (popover uses `Tooltip`)
- `defineVariableInputBoxBddSteps(bdd)` (pattern input)

Core steps:

- `Then date time picker {string} should be visible`
- `When I open date time picker {string}`
- `When I close date time picker {string}`
- `Then date time picker {string} should be open`
- `Then date time picker {string} should be closed`
- `When I go to previous month in date time picker {string}`
- `When I go to next month in date time picker {string}`
- `When I select day {string} in date time picker {string}`
- `Then date time picker {string} day {string} should be selected`
- `When I set date time picker {string} include time to {string}`
- `When I set date time picker {string} hours to {int}`
- `When I set date time picker {string} minutes to {int}`
- `When I set date time picker {string} output mode to {string}`
- `Then date time picker {string} output mode should be {string}`

### Typing policy

When editing the pattern, reuse the existing `VariableInputBox` steps which already type **letter-by-letter**.
