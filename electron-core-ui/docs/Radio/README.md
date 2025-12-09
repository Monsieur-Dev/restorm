# Radio Component

## Overview

The `RadioGroup` component is a React implementation of VSCode's Radio widget. It provides a horizontal group of radio button options with VSCode styling, theme integration, and full accessibility support.

## API

### Interfaces TypeScript

```typescript
export interface IRadioStyles {
  readonly activeForeground?: string;
  readonly activeBackground?: string;
  readonly activeBorder?: string;
  readonly inactiveForeground?: string;
  readonly inactiveBackground?: string;
  readonly inactiveHoverBackground?: string;
  readonly inactiveBorder?: string;
}

export interface IRadioOptionItem {
  readonly text: string;
  readonly tooltip?: string;
  readonly isActive?: boolean;
  readonly disabled?: boolean;
}

export interface IRadioOptions {
  readonly items: ReadonlyArray<IRadioOptionItem>;
  readonly styles?: IRadioStyles;
}

export interface RadioGroupProps {
  options: IRadioOptions;
  onSelect?: (index: number) => void;
  className?: string;
  id?: string;
}
```

### Props

- **options** (`IRadioOptions`) : Radio group configuration
  - `items` : Array of radio option items
  - `styles` : Custom styles (optional, uses VSCode default styles if not provided)

- **onSelect** (`(index: number) => void`) : Callback called when an option is selected
- **className** (`string`) : Additional CSS classes
- **id** (`string`) : HTML ID of the radio group

### Radio Option Item Properties

- **text** (`string`) : Display text for the option
- **tooltip** (`string`) : Tooltip text shown on hover
- **isActive** (`boolean`) : Whether this option is currently selected
- **disabled** (`boolean`) : Whether this option is disabled

## Usage Examples

### Basic Radio Group

```tsx
import { RadioGroup } from 'electron-core-ui/renderer'

const [selectedIndex, setSelectedIndex] = useState(0)

<RadioGroup
  options={{
    items: [
      { text: 'Option 1', isActive: selectedIndex === 0 },
      { text: 'Option 2', isActive: selectedIndex === 1 },
      { text: 'Option 3', isActive: selectedIndex === 2 }
    ]
  }}
  onSelect={(index) => setSelectedIndex(index)}
/>
```

### Radio Group with Disabled Options

```tsx
<RadioGroup
  options={{
    items: [
      { text: 'Enabled Option', isActive: true },
      { text: 'Disabled Option', disabled: true },
      { text: 'Another Option' }
    ]
  }}
  onSelect={(index) => console.log('Selected:', index)}
/>
```

### Radio Group with Tooltips

```tsx
<RadioGroup
  options={{
    items: [
      { text: 'Option A', tooltip: 'This is option A' },
      { text: 'Option B', tooltip: 'This is option B', isActive: true },
      { text: 'Option C', tooltip: 'This is option C' }
    ]
  }}
  onSelect={(index) => handleSelection(index)}
/>
```

### Radio Group with Custom Styles

```tsx
import { RadioGroup, defaultRadioStyles } from 'electron-core-ui/renderer'

<RadioGroup
  options={{
    items: [
      { text: 'Custom Option 1' },
      { text: 'Custom Option 2', isActive: true }
    ],
    styles: {
      ...defaultRadioStyles,
      activeForeground: '#ff0000', // Red text for active option
      activeBackground: '#ffff00'  // Yellow background for active option
    }
  }}
  onSelect={(index) => setSelectedIndex(index)}
/>
```

## DOM Structure

The component generates the following DOM structure:

```html
<div class="monaco-custom-radio" role="radiogroup">
  <button class="monaco-button active" role="radio" aria-checked="true" aria-label="Option 1">
    Option 1
  </button>
  <button class="monaco-button" role="radio" aria-checked="false" aria-label="Option 2">
    Option 2
  </button>
  <button class="monaco-button" role="radio" aria-checked="false" aria-label="Option 3">
    Option 3
  </button>
</div>
```

## CSS Classes Used

- **monaco-custom-radio** : Container for the radio group
- **monaco-button** : Base class for each radio button
- **active** : Applied to the currently selected button
- **previous-active** : Applied to the previously selected button (for styling transitions)

## VSCode Theme Variables

The component uses the following CSS variables:

- `--ecui-radio-activeForeground` : Text color of active option
- `--ecui-radio-activeBackground` : Background color of active option
- `--ecui-radio-activeBorder` : Border color of active option
- `--ecui-radio-inactiveForeground` : Text color of inactive options
- `--ecui-radio-inactiveBackground` : Background color of inactive options
- `--ecui-radio-inactiveHoverBackground` : Background color on hover for inactive options
- `--ecui-radio-inactiveBorder` : Border color of inactive options

## Keyboard Navigation

- **Arrow Keys** : Navigate between options (left/right)
- **Space/Enter** : Select the focused option
- **Tab** : Navigate to next focusable element

## Accessibility

The component implements the following ARIA attributes:

- `role="radiogroup"` : Indicates this is a radio group
- `role="radio"` : Indicates each button is a radio option
- `aria-checked` : Current checked state of each option
- `aria-label` : Accessible label for each option

## State Management

The component automatically handles:
- Active option selection
- Visual state updates (active/inactive)
- Disabled state handling
- Click event management
- Keyboard navigation

## Theme Integration

The component automatically adapts to VSCode themes through CSS variables. No additional configuration is required.

## Performance

The component uses `useCallback` to optimize performance and avoid unnecessary re-renders.

## Notes for AI Usage

### Recommended Configuration

For optimal usage, always use VSCode theme variables:

```typescript
const defaultRadioStyles: IRadioStyles = {
  activeForeground: 'var(--ecui-radio-activeForeground)',
  activeBackground: 'var(--ecui-radio-activeBackground)',
  activeBorder: 'var(--ecui-radio-activeBorder)',
  inactiveForeground: 'var(--ecui-radio-inactiveForeground)',
  inactiveBackground: 'var(--ecui-radio-inactiveBackground)',
  inactiveHoverBackground: 'var(--ecui-radio-inactiveHoverBackground)',
  inactiveBorder: 'var(--ecui-radio-inactiveBorder)'
}
```

### Common Patterns

1. **Controlled Component**: Use `isActive` prop to control which option is selected
2. **Event Handling**: Use `onSelect` callback to handle selection changes
3. **Disabled States**: Use `disabled` prop to disable specific options
4. **Tooltips**: Use `tooltip` prop to provide additional information

### Integration with Forms

```tsx
const [formData, setFormData] = useState({ theme: 'dark' })

<RadioGroup
  options={{
    items: [
      { text: 'Light', isActive: formData.theme === 'light' },
      { text: 'Dark', isActive: formData.theme === 'dark' },
      { text: 'Auto', isActive: formData.theme === 'auto' }
    ]
  }}
  onSelect={(index) => {
    const themes = ['light', 'dark', 'auto']
    setFormData(prev => ({ ...prev, theme: themes[index] }))
  }}
/>
```

### Multiple Radio Groups

```tsx
// Each radio group is independent
<div>
  <h4>Theme Selection</h4>
  <RadioGroup options={themeOptions} onSelect={handleThemeSelect} />
</div>

<div>
  <h4>Language Selection</h4>
  <RadioGroup options={languageOptions} onSelect={handleLanguageSelect} />
</div>
```
