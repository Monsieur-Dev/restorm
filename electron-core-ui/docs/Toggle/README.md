# Toggle Component

## Overview

The `Toggle` component is a React implementation of VSCode's Toggle component. It provides a custom checkbox interface with codicon support, keyboard navigation, and full accessibility.

## API

### Interfaces TypeScript

```typescript
export interface IToggleOpts extends IToggleStyles {
  readonly actionClassName?: string;
  readonly icon?: string; // Nom de l'icône codicon (ex: 'check')
  readonly title: string;
  readonly isChecked: boolean;
  readonly notFocusable?: boolean;
}

export interface IToggleStyles {
  readonly inputActiveOptionBorder: string | undefined;
  readonly inputActiveOptionForeground: string | undefined;
  readonly inputActiveOptionBackground: string | undefined;
}

export interface ToggleProps {
  opts: IToggleOpts;
  onChange?: (checked: boolean, viaKeyboard: boolean) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}
```

### Props

- **opts** (`IToggleOpts`) : Toggle configuration options
  - `title` : Accessible label for the toggle
  - `isChecked` : Initial checked/unchecked state
  - `icon` : Codicon name (default 'check')
  - `actionClassName` : Additional CSS classes
  - `notFocusable` : Whether the toggle should not be focusable
  - `inputActiveOptionBorder` : Border color when active
  - `inputActiveOptionForeground` : Text color when active
  - `inputActiveOptionBackground` : Background color when active

- **onChange** (`(checked: boolean, viaKeyboard: boolean) => void`) : Callback called on state change
- **onKeyDown** (`(event: React.KeyboardEvent) => void`) : Callback for keyboard events
- **disabled** (`boolean`) : Disables the toggle
- **className** (`string`) : Additional CSS classes
- **id** (`string`) : HTML ID of the toggle
- **styles** (`IToggleStyles`) : Custom styles (optional, uses VSCode default styles if not provided)

## Usage Examples

### Basic Toggle

```tsx
import { Toggle } from 'electron-core-ui/renderer'

const [checked, setChecked] = useState(false)

<Toggle
  opts={{
    title: 'Enable notifications',
    isChecked: checked,
    icon: 'check',
    inputActiveOptionBorder: 'var(--inputOption-activeBorder)',
    inputActiveOptionForeground: 'var(--inputOption-activeForeground)',
    inputActiveOptionBackground: 'var(--inputOption-activeBackground)'
  }}
  onChange={(checked) => setChecked(checked)}
/>
```

### Disabled Toggle

```tsx
<Toggle
  opts={{
    title: 'Disabled option',
    isChecked: false,
    icon: 'check',
    inputActiveOptionBorder: 'var(--inputOption-activeBorder)',
    inputActiveOptionForeground: 'var(--inputOption-activeForeground)',
    inputActiveOptionBackground: 'var(--inputOption-activeBackground)'
  }}
  disabled={true}
/>
```

### Toggle with Custom Icon

```tsx
<Toggle
  opts={{
    title: 'Custom icon toggle',
    isChecked: false,
    icon: 'star', // Utilise l'icône star au lieu de check
    inputActiveOptionBorder: 'var(--inputOption-activeBorder)',
    inputActiveOptionForeground: 'var(--inputOption-activeForeground)',
    inputActiveOptionBackground: 'var(--inputOption-activeBackground)'
  }}
  onChange={(checked) => console.log('Star toggled:', checked)}
/>
```

### Toggle with Custom Styles

```tsx
import { Toggle, defaultToggleStyles } from 'electron-core-ui/renderer'

<Toggle
  opts={{
    title: 'Custom styled toggle',
    isChecked: false,
    icon: 'check'
  }}
  styles={{
    ...defaultToggleStyles,
    inputActiveOptionForeground: '#ff0000', // Rouge au lieu du style par défaut
    inputActiveOptionBackground: '#ffff00'  // Jaune au lieu du style par défaut
  }}
  onChange={(checked) => setChecked(checked)}
/>
```

## DOM Structure

The component generates the following DOM structure:

```html
<div
  class="monaco-custom-toggle codicon codicon-check checked"
  tabindex="0"
  role="checkbox"
  aria-checked="true"
  aria-label="Toggle title"
  aria-disabled="false"
  style="color: var(--inputOption-activeForeground); background-color: var(--inputOption-activeBackground); border-color: var(--inputOption-activeBorder);"
>
</div>
```

## CSS Classes Used

- **monaco-custom-toggle** : Base toggle class
- **codicon** : Icon font class
- **codicon-{iconName}** : Specific icon class (e.g. codicon-check)
- **checked** : Applied when toggle is checked
- **disabled** : Applied when toggle is disabled

## VSCode Theme Variables

The component uses the following CSS variables:

- `--inputOption-activeBorder` : Active toggle border
- `--inputOption-activeForeground` : Active icon color
- `--inputOption-activeBackground` : Active toggle background
- `--inputOption-hoverBackground` : Hover background
- `--focusBorder` : Focus border (high contrast mode)

## Codicon Support

The component uses VSCode's codicon font to display icons. Available icons include:

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

For optimal usage, always use VSCode theme variables:

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

The component automatically adapts to VSCode themes through CSS variables. No additional configuration is required.

### Performance

The component uses `useCallback` to optimize performance and avoid unnecessary re-renders.
