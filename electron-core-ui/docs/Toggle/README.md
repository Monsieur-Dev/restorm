# Toggle Component

## Overview

The `Toggle` component is a custom checkbox / tri-state checkbox primitive with codicon support, full keyboard navigation, and ARIA-correct accessibility (`role="checkbox"`, `aria-checked` including the `"mixed"` value for `indeterminate`).

It accepts either the legacy binary `isChecked` prop or the newer tri-state `state` prop. The two forms can coexist — `state` wins when both are provided — but new code should prefer `state` because it's the only path that exposes the `indeterminate` value.

## API

### TypeScript Interfaces

```typescript
export type ToggleState = 'checked' | 'unchecked' | 'indeterminate';

export interface IToggleStyles {
  readonly inputActiveOptionBorder: string | undefined;
  readonly inputActiveOptionForeground: string | undefined;
  readonly inputActiveOptionBackground: string | undefined;
}

export interface ToggleProps {
  state?: ToggleState;
  isChecked?: boolean;
  onChange?: (checked: boolean, viaKeyboard: boolean) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  'data-testid'?: string;
  styles?: IToggleStyles;
  icon?: string;
  indeterminateIcon?: string;
  actionClassName?: string;
  notFocusable?: boolean;
  children?: React.ReactNode;
}
```

### Props

- **state** (`ToggleState`) : Explicit tri-state value. Takes precedence over `isChecked` when both are provided. Use this when you need the `indeterminate` visual (e.g. tri-state checkbox trees).
- **isChecked** (`boolean`) : Binary alternative kept for backward compatibility. Equivalent to `state === 'checked'` when `state` is omitted.
- **onChange** (`(checked: boolean, viaKeyboard: boolean) => void`) : Fired when the user clicks or presses Space / Enter on the toggle. `checked` is `true` after `unchecked`/`indeterminate` (the latter "completes" the partial state) and `false` after `checked`. `viaKeyboard` distinguishes Space/Enter activations from mouse clicks.
- **onKeyDown** (`(event: React.KeyboardEvent) => void`) : Forwarded keyboard handler.
- **disabled** (`boolean`) : Disables the toggle (no `onChange`, no hover, dimmed visual).
- **className** (`string`) : Additional CSS classes on the root.
- **id** (`string`) : DOM id on the inner action element.
- **styles** (`IToggleStyles`) : Optional override for the active-state colours. Falls back to `defaultToggleStyles`.
- **icon** (`string`) : Codicon name for the `checked` state. Default `'check'`.
- **indeterminateIcon** (`string`) : Codicon name for the `indeterminate` state. Default `'dash'`, matching the native `<input type="checkbox" indeterminate>` look.
- **actionClassName** (`string`) : Additional CSS class applied to the inner action element.
- **notFocusable** (`boolean`) : Disable Tab focus on the action.
- **children** (`React.ReactNode`) : Optional label rendered next to the toggle. Clicking the label toggles too.
- **data-testid** (`string`) : Optional test id applied to the Toggle root element.

### State management

`Toggle` is fully prop-controlled — it does **not** keep a private mirror of `state` / `isChecked`. Render the value from your own state, and update it in the `onChange` handler. This is what lets a parent in a tri-state tree force its children's state during a cascade (e.g. clicking a folder Toggle to flip every descendant), or re-sync a Toggle to an external value (loaded from disk, restored from history, etc.) without losing the change.

## Usage

### Binary toggle (backward compatible)

```tsx
import { Toggle } from 'electron-core-ui/renderer'

const [checked, setChecked] = useState(false)

<Toggle
  isChecked={checked}
  onChange={(nextChecked) => setChecked(nextChecked)}
>
  Enable notifications
</Toggle>
```

### Tri-state toggle (new)

```tsx
import { Toggle, type ToggleState } from 'electron-core-ui/renderer'

const [state, setState] = useState<ToggleState>('indeterminate')

<Toggle
  state={state}
  onChange={(checked) => setState(checked ? 'checked' : 'unchecked')}
>
  Apply to descendants
</Toggle>
```

A click on an `indeterminate` Toggle calls `onChange(true, …)` — the user is "completing" the partial state. If you want to walk the cycle the other way (e.g. indeterminate → unchecked), explicitly handle the previous value yourself in `onChange` and override the next value.

### Disabled toggle

```tsx
<Toggle disabled state="checked">
  Read-only option
</Toggle>
```

### Custom indeterminate glyph

```tsx
<Toggle
  state="indeterminate"
  indeterminateIcon="remove"
  onChange={(checked) => { /* … */ }}
>
  Custom dash
</Toggle>
```

## DOM Structure

```html
<div class="toggle-container">
  <div
    class="custom-toggle <state>"
    role="checkbox"
    aria-checked="true | false | mixed"
    aria-disabled="false"
    data-state="checked | unchecked | indeterminate"
    data-is-checked="true | false"
    data-is-indeterminate="true | false"
    data-is-disabled="true | false"
  >
    <span class="codicon codicon-<icon>"></span>
  </div>
  <span>Label</span>
</div>
```

## CSS Classes

- `custom-toggle` : Base toggle class (always present).
- `checked` : Applied when `state === 'checked'`.
- `indeterminate` : Applied when `state === 'indeterminate'`.
- `disabled` : Applied when disabled.

The component also writes inline styles on the action element to wire colours through theme variables; see *Theme Variables* below.

## Theme Variables

- `--inputOption-activeBorder` : Active toggle border (used by both `checked` and `indeterminate`).
- `--inputOption-activeForeground` : Active icon color.
- `--inputOption-activeBackground` : Active toggle background.
- `--inputOption-hoverBackground` : Hover background.
- `--checkbox-background` : Checked fill (transparent for indeterminate).
- `--checkbox-border` : Unchecked border.
- `--checkbox-foreground` : Default icon colour.
- `--checkbox-disabled-background` / `--checkbox-disabled-foreground` : Disabled colours.
- `--focusBorder` : Focus border (high-contrast mode).

## Codicon Support

The component renders icons via the codicon font. Defaults: `'check'` for `checked`, `'dash'` for `indeterminate`. Override via `icon` / `indeterminateIcon` if your domain needs a different glyph (e.g. `'star'`, `'remove'`, `'minus'`).

## Keyboard Navigation

- **Space** / **Enter** : Toggle the value. From `indeterminate` this promotes to `checked`.
- **Tab** : Move focus to the next focusable element.

## Accessibility

- `role="checkbox"` on the action element.
- `aria-checked="true" | "false" | "mixed"` reflects `state` exactly. `"mixed"` is the ARIA-spec value for indeterminate, read by screen readers as "partially checked".
- `aria-label` defaults to the string `children` content when present, otherwise `"Toggle"`. Override by wrapping with your own labelled-by element if needed.
- `aria-disabled` reflects the `disabled` prop.

## Testing

### `data-testid`

When `data-testid="my-toggle"` is provided:

- Root: `my-toggle`
- Action (`role="checkbox"`): `my-toggle-action`
- Label (when `children` is provided): `my-toggle-label`
- Icon (only when `state` is `checked` or `indeterminate`): `my-toggle-icon`

The action element also exposes:

- `data-state="checked|unchecked|indeterminate"`
- `data-is-checked="true|false"`
- `data-is-indeterminate="true|false"`
- `data-is-disabled="true|false"`

### Selectors

Pure string selectors from `electron-core-ui/testing`:

- `toggleRootSelector(testId)`
- `toggleActionSelector(testId)`
- `toggleLabelSelector(testId)`
- `toggleIconSelector(testId)`

### Playwright-BDD steps

Reusable steps from `electron-core-ui/testing/playwright-bdd`:

- `Then toggle {string} should be visible`
- `Then toggle {string} should be checked`
- `Then toggle {string} should be unchecked`
- `Then toggle {string} should be indeterminate`
- `Then toggle {string} should be disabled`
- `When I click toggle {string}`
- `When I click toggle {string} label`
- `When I press {string} on toggle {string}`
