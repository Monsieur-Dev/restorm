# Toggle Component

## Overview

The `Toggle` component is a React implementation of the Toggle component. It provides a custom checkbox interface with codicon support, keyboard navigation, and full accessibility.

## API

### Interfaces TypeScript

```typescript
export interface IToggleStyles {
  readonly inputActiveOptionBorder: string | undefined;
  readonly inputActiveOptionForeground: string | undefined;
  readonly inputActiveOptionBackground: string | undefined;
}

export interface ToggleProps {
  isChecked: boolean;
  onChange?: (checked: boolean, viaKeyboard: boolean) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  'data-testid'?: string;
  styles?: IToggleStyles;
  icon?: string;
  actionClassName?: string;
  notFocusable?: boolean;
  children?: React.ReactNode;
}
```

### Props

- **isChecked** (`boolean`) : Initial checked/unchecked state
- **onChange** (`(checked: boolean, viaKeyboard: boolean) => void`) : Callback called on state change
- **onKeyDown** (`(event: React.KeyboardEvent) => void`) : Callback for keyboard events
- **disabled** (`boolean`) : Disables the toggle
- **className** (`string`) : Additional CSS classes
- **id** (`string`) : HTML ID of the toggle
- **styles** (`IToggleStyles`) : Custom styles (optional, uses default styles if not provided)
- **icon** (`string`) : Codicon name (default 'check')
- **actionClassName** (`string`) : Additional CSS class applied to the checkbox action
- **notFocusable** (`boolean`) : Whether the checkbox action should not be focusable
- **children** (`React.ReactNode`) : Optional label (also clickable)
- **data-testid** (`string`) : Optional test id applied to the Toggle root element

## Usage Examples

### Basic Toggle

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

### Disabled Toggle

```tsx
<Toggle
  disabled={true}
  isChecked={false}
>
  Disabled option
</Toggle>
```

### Toggle with Custom Icon

```tsx
<Toggle
  isChecked={false}
  icon="star"
  onChange={(checked) => { /* ... */ }}
>
  Custom icon toggle
</Toggle>
```

### Toggle with Custom Styles

```tsx
import { Toggle, defaultToggleStyles } from 'electron-core-ui/renderer'

<Toggle
  isChecked={false}
  styles={{
    ...defaultToggleStyles,
    inputActiveOptionForeground: '#ff0000', // Rouge au lieu du style par défaut
    inputActiveOptionBackground: '#ffff00'  // Jaune au lieu du style par défaut
  }}
  onChange={(checked) => setChecked(checked)}
>
  Custom styled toggle
</Toggle>
```

## DOM Structure

The component generates the following DOM structure:

```html
<div class="toggle-container">
  <div class="custom-toggle checked" role="checkbox" aria-checked="true" aria-disabled="false"></div>
  <span>Label</span>
</div>
```

## CSS Classes Used

- **monaco-custom-toggle** : Base toggle class
- **codicon** : Icon font class
- **codicon-{iconName}** : Specific icon class (e.g. codicon-check)
- **checked** : Applied when toggle is checked
- **disabled** : Applied when toggle is disabled

## Theme Variables

The component uses the following CSS variables:

- `--inputOption-activeBorder` : Active toggle border
- `--inputOption-activeForeground` : Active icon color
- `--inputOption-activeBackground` : Active toggle background
- `--inputOption-hoverBackground` : Hover background
- `--focusBorder` : Focus border (high contrast mode)

## Codicon Support

The component uses the codicon font to display icons. Available icons include:

- `check` : Check mark (default)
- `star` : Star
- `heart` : Heart
- `plus` : Plus
- `minus` : Minus
- And all other codicon icons

## Keyboard Navigation

- **Space** : Toggle checked/unchecked state
- **Enter** : Toggle checked/unchecked state
- **Tab** : Navigate to next focusable element

## Accessibility

The component implements the following ARIA attributes:

- `role="checkbox"` : Indicates this is a checkbox
- `aria-checked` : Checked/unchecked state
- `aria-label` : Accessible label
- `aria-disabled` : Disabled/enabled state

## Notes for AI Usage

### Recommended Configuration

For optimal usage, always use theme variables:

```typescript
const defaultToggleStyles: IToggleStyles = {
  inputActiveOptionBorder: 'var(--inputOption-activeBorder)',
  inputActiveOptionForeground: 'var(--inputOption-activeForeground)',
  inputActiveOptionBackground: 'var(--inputOption-activeBackground)'
}
```

### State Management

The component automatically handles:
- Checked/unchecked state
- Visual styles based on state
- Keyboard navigation
- Accessibility

### Theme Integration

The component automatically adapts to themes through CSS variables. No additional configuration is required.

### Performance

The component uses `useCallback` to optimize performance and avoid unnecessary re-renders.

## Testing

### `data-testid`

The component supports an optional `data-testid` prop that is applied to the root element and used to derive stable hooks for E2E tests.

When `data-testid="my-toggle"` is provided, the following test ids are available:

- Root: `my-toggle`
- Action (role=checkbox): `my-toggle-action`
- Label (if `children` is provided): `my-toggle-label`
- Icon (only when checked): `my-toggle-icon`

The action element also exposes:

- `data-is-checked="true|false"`
- `data-is-disabled="true|false"`

### Selectors

Use the pure string selectors from `electron-core-ui/testing`:

- `toggleRootSelector(testId)`
- `toggleActionSelector(testId)`
- `toggleLabelSelector(testId)`
- `toggleIconSelector(testId)`

### Playwright-BDD steps

Reusable steps are available from `electron-core-ui/testing/playwright-bdd`:

- `Then toggle {string} should be visible`
- `Then toggle {string} should be checked`
- `Then toggle {string} should be unchecked`
- `Then toggle {string} should be disabled`
- `When I click toggle {string}`
- `When I click toggle {string} label`
- `When I press {string} on toggle {string}`
