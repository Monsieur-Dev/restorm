# SelectBox Component

## Overview

The `SelectBox` component is a React implementation of the SelectBox widget. It provides both native and custom dropdown implementations with full theme styling, theme integration, accessibility support, and advanced features like descriptions, decorators, and scrolling for long lists.

## API

### TypeScript Interfaces

```typescript
// Main SelectBox props
export interface SelectBoxProps {
  options: ISelectOptionItem[]
  selected?: number
  onDidSelect?: (data: ISelectData) => void
  selectBoxOptions?: ISelectBoxOptions
  styles?: ISelectBoxStyles
  className?: string
  id?: string
  /** Threshold (inclusive) at or above which the filter row appears. Default: 15. */
  filterThreshold?: number
  /** Localised placeholder for the filter input. Default: `Filter…`. */
  filterPlaceholder?: string
  /** Test id forwarded to the filter row (suffix `-input` for the field). */
  filterTestId?: string
  /** When true, the whole control is locked: greyed out, closed, and inert
   * to pointer + keyboard input. Default `false`. */
  disabled?: boolean
}

// Select option item interface
export interface ISelectOptionItem {
  text: string
  detail?: string
  decoratorRight?: string
  description?: string
  descriptionIsMarkdown?: boolean
  readonly descriptionMarkdownActionHandler?: any
  isDisabled?: boolean
}

// SelectBox options
export interface ISelectBoxOptions {
  useCustomDrawn?: boolean
  ariaLabel?: string
  ariaDescription?: string
  minBottomMargin?: number
  optionsAsChildren?: boolean
}

// SelectBox styles
export interface ISelectBoxStyles {
  readonly selectBackground: string | undefined
  readonly selectListBackground: string | undefined
  readonly selectForeground: string | undefined
  readonly decoratorRightForeground: string | undefined
  readonly selectBorder: string | undefined
  readonly selectListBorder: string | undefined
  readonly focusBorder: string | undefined
  readonly listFocusBackground: string | undefined
  readonly listFocusForeground: string | undefined
  readonly listHoverBackground: string | undefined
  readonly listHoverForeground: string | undefined
  readonly listFocusOutline: string | undefined
  readonly listHoverOutline: string | undefined
}

// Selection data
export interface ISelectData {
  selected: string
  index: number
}
```

### Props

- **options** (`ISelectOptionItem[]`) : Array of select options
  - `text` : Main option text (required)
  - `detail` : Additional detail text shown next to main text
  - `decoratorRight` : Right-aligned decorator text (e.g., "Default")
  - `description` : Description shown in details pane at bottom of dropdown
  - `descriptionIsMarkdown` : Whether description supports markdown
  - `descriptionMarkdownActionHandler` : Handler for markdown actions
  - `isDisabled` : Whether option is disabled

- **selected** (`number`) : Index of currently selected option (default: 0)
- **onDidSelect** (`(data: ISelectData) => void`) : Callback fired when selection changes
- **selectBoxOptions** (`ISelectBoxOptions`) : SelectBox configuration
  - `useCustomDrawn` : Force custom dropdown (default: auto-detect based on platform)
  - `ariaLabel` : ARIA label for accessibility
  - `ariaDescription` : ARIA description
  - `minBottomMargin` : Minimum bottom margin for dropdown positioning
  - `optionsAsChildren` : Whether options are rendered as children

- **styles** (`ISelectBoxStyles`) : Custom styling overrides
- **className** (`string`) : Additional CSS classes
- **id** (`string`) : HTML ID of the select element
- **filterThreshold** (`number`) : Item count (inclusive) at or above which a sticky filter input appears at the top of the popup. Default `15`. See [Filtering long lists](#filtering-long-lists).
- **filterPlaceholder** (`string`) : Localised placeholder for the filter input. Default `Filter…`.
- **filterTestId** (`string`) : Test id forwarded to the filter row (suffixed with `-input` for the field).
- **disabled** (`boolean`) : Locks the whole control (as opposed to `ISelectOptionItem.isDisabled`, which locks a single option). The trigger is greyed (matches the `InputBox`/`Toggle` disabled dimming), the dropdown can't be opened, and both pointer and keyboard input are inert — clicking, Enter/Space/arrow-keys all no-op. Default `false`. See [SelectBox with Disabled Control](#selectbox-with-disabled-control).

## Usage Examples

### Basic SelectBox

```tsx
import { SelectBox } from 'electron-core-ui/renderer'

<SelectBox
  options={[
    { text: 'Option 1' },
    { text: 'Option 2' },
    { text: 'Option 3' }
  ]}
  selected={0}
  onDidSelect={(data) => {
    console.log('Selected:', data.selected, 'Index:', data.index)
  }}
/>
```

### SelectBox with Descriptions

```tsx
<SelectBox
  options={[
    { 
      text: 'Visual Studio Dark', 
      description: 'The default dark theme for Visual Studio Code' 
    },
    { 
      text: 'Monokai', 
      description: 'A popular dark theme with vibrant colors' 
    }
  ]}
  selected={0}
  onDidSelect={(data) => console.log('Theme selected:', data.selected)}
  selectBoxOptions={{ 
    ariaLabel: 'Theme selector',
    useCustomDrawn: true // Force custom dropdown to show descriptions
  }}
/>
```

### SelectBox with Decorators

```tsx
<SelectBox
  options={[
    { text: 'English', decoratorRight: 'Default' },
    { text: 'Français', decoratorRight: '' },
    { text: 'Español', decoratorRight: '' }
  ]}
  selected={0}
  onDidSelect={(data) => console.log('Language:', data.selected)}
/>
```

### SelectBox with Disabled Options

```tsx
<SelectBox
  options={[
    { text: 'Enabled Option', isDisabled: false },
    { text: 'Disabled Option', isDisabled: true },
    { text: 'Another Enabled', isDisabled: false }
  ]}
  selected={0}
  onDidSelect={(data) => console.log('Selected:', data.selected)}
/>
```

### SelectBox with Disabled Control

Locks the whole control — distinct from `isDisabled` on a single option above. Typical use: a config field that must stay read-only while a resource it configures is active (e.g. a mock server that snapshotted its config on start).

```tsx
<SelectBox
  options={[{ text: 'unary' }, { text: 'server-stream' }]}
  selected={0}
  onDidSelect={(data) => console.log('Call type:', data.selected)}
  disabled={isServerListening}
/>
```

### SelectBox with Long List (Scrolling)

```tsx
<SelectBox
  options={Array.from({ length: 100 }, (_, i) => ({
    text: `Option ${i + 1}`,
    description: `This is option number ${i + 1}`,
    isDisabled: i % 10 === 0 // Disable every 10th option
  }))}
  selected={0}
  onDidSelect={(data) => console.log('Selected:', data.selected)}
  selectBoxOptions={{
    useCustomDrawn: true,
    ariaLabel: 'Long list selector'
  }}
  // Filter row is on by default for ≥ 15 options. Override the
  // threshold or the placeholder per-instance:
  filterThreshold={20}
  filterPlaceholder="Type to filter…"
  filterTestId="long-list-filter"
/>
```

### Force Native Select (macOS)

```tsx
<SelectBox
  options={[
    { text: 'Option 1' },
    { text: 'Option 2' },
    { text: 'Option 3' }
  ]}
  selected={0}
  onDidSelect={(data) => console.log('Selected:', data.selected)}
  selectBoxOptions={{ 
    useCustomDrawn: false // Force native select even on macOS
  }}
/>
```

### Custom Styling

```tsx
<SelectBox
  options={[
    { text: 'Custom Styled Option' }
  ]}
  selected={0}
  onDidSelect={(data) => console.log('Selected:', data.selected)}
  styles={{
    selectBackground: '#ff6b6b',
    selectForeground: '#ffffff',
    selectBorder: '#ff5252',
    listFocusBackground: '#ff8a80',
    listFocusForeground: '#ffffff'
  }}
/>
```

## DOM Structure

### Custom Dropdown Structure

```html
<div class="select-container">
  <div class="monaco-select-box monaco-select-box-dropdown-padding synthetic-focus" 
       role="combobox" aria-expanded="true" aria-haspopup="listbox">
    <span>Selected Option</span>
    <svg><!-- Chevron icon --></svg>
  </div>
  
  <div class="monaco-select-box-dropdown-container visible">
    <div class="select-box-dropdown-list-container">
      <div role="listbox" tabindex="0">
        <div role="option" aria-selected="true">
          <div>
            <span class="option-text">Option Text</span>
            <span class="option-detail">Option Detail</span>
          </div>
          <span class="option-decorator-right">Default</span>
        </div>
      </div>
    </div>
    
    <div class="select-box-details-pane border-top">
      Option description text
    </div>
  </div>
</div>
```

## Testing

### `data-testid` API

`SelectBox` exposes stable hooks via `data-testid` (default: `selectbox`):

- Root: `data-testid={id}`
  - attributes: `data-is-open`, `data-selected-index`, `data-focused-index`
- Trigger: `${id}-trigger`
- Dropdown: `${id}-dropdown`
- ScrollableElement: `${id}-scrollable`
- Listbox: `${id}-listbox`
- Option row: `${id}-option-${index}` (attributes: `data-is-selected`, `data-is-disabled`, `data-is-focused`)
  - label: `${id}-option-${index}-label`
  - detail: `${id}-option-${index}-detail`
  - decorator: `${id}-option-${index}-decorator`
- Details pane: `${id}-details`

Native variant:

- Root: `data-testid={id}` + attributes `data-selected-index`, `data-selected-value`
- `<select>`: `${id}-native` + same attributes

### Selectors (electron-core-ui/testing)

- `selectBoxRootSelector(testId)`
- `selectBoxTriggerSelector(testId)`
- `selectBoxDropdownSelector(testId)`
- `selectBoxScrollableSelector(testId)`
- `selectBoxListboxSelector(testId)`
- `selectBoxOptionSelector(testId, index)`
- `selectBoxOptionLabelSelector(testId, index)`
- `selectBoxOptionDetailSelector(testId, index)`
- `selectBoxOptionDecoratorSelector(testId, index)`
- `selectBoxDetailsSelector(testId)`

### Playwright-BDD steps (electron-core-ui/testing/playwright-bdd)

Register:

- `defineSelectBoxBddSteps(bdd)`
- `defineScrollableElementBddSteps(bdd)` (for `${id}-scrollable`)

Steps:

- `Then select box {string} should be visible`
- `Then select box {string} should be open`
- `Then select box {string} should be closed`
- `Then select box {string} selected index should be {int}`
- `Then select box {string} selected label should be {string}`
- `Then select box {string} focused index should be {int}`
- `Then select box {string} focused label should be {string}`
- `Then select box {string} option {int} should be disabled`
- `Then select box {string} option with label {string} should be disabled`
- `Then select box {string} details should contain {string}`
- `When I open select box {string}`
- `When I close select box {string}`
- `When I select option {int} in select box {string}`
- `When I select option with label {string} in select box {string}`
- `When I press {string} in select box {string}`

### Deterministic E2E configuration

For reliable E2E tests, prefer forcing the custom dropdown:

- `selectBoxOptions={{ useCustomDrawn: true }}`

### Native Select Structure

```html
<div class="select-container">
  <select class="monaco-select-box">
    <option value="Option 1">Option 1</option>
    <option value="Option 2">Option 2</option>
    <option value="Option 3">Option 3</option>
  </select>
</div>
```

## CSS Classes

### Base Classes

- **`.select-container`** : Container for the select element
- **`.select-box`** : Base select element class
- **`.select-box-dropdown-padding`** : Custom padding for dropdown calculations

### Custom Dropdown Classes

- **`.select-box-dropdown-container`** : Custom dropdown container
- **`.select-box-dropdown-list-container`** : Container for option list
- **`.select-box-details-pane`** : Details pane at bottom of dropdown
- **`.option-text`** : Main option text
- **`.option-detail`** : Option detail text
- **`.option-decorator-right`** : Right-aligned decorator text
- **`.option-disabled`** : Disabled option styling
- **`.visible`** : Applied when dropdown is visible
- **`.synthetic-focus`** : Applied when element has synthetic focus
- **`.disabled`** : Applied to `.select-box` (both the native `<select>` and the custom-drawn trigger) when the `disabled` prop is set — greyed + `pointer-events: none`

## Theme Variables

The component uses the following CSS variables:

### Select Element
- `--settings-dropdownBackground` : Background color
- `--settings-dropdownForeground` : Text color
- `--settings-dropdownBorder` : Border color
- `--settings-dropdownHoverBackground` : Hover background

### Dropdown List
- `--editor-background` : Dropdown background
- `--panel-border` : Dropdown border
- `--list-activeSelectionBackground` : Selected option background
- `--list-activeSelectionForeground` : Selected option text
- `--list-hoverBackground` : Hover option background
- `--list-hoverForeground` : Hover option text
- `--focusBorder` : Focus outline color
- `--descriptionForeground` : Description text color

## Platform Behavior

### Automatic Platform Detection

- **macOS**: Uses native `<select>` element by default
- **Windows/Linux**: Uses custom dropdown with List widget

### Force Custom Dropdown

Set `useCustomDrawn: true` to force custom dropdown on all platforms:

```tsx
<SelectBox
  options={options}
  selectBoxOptions={{ useCustomDrawn: true }}
  // ... other props
/>
```

## Keyboard Navigation

### Custom Dropdown
- **Arrow Down/Up**: Navigate between options
- **Enter/Space**: Select focused option
- **Escape**: Close dropdown
- **Home/End**: Jump to first/last option
- **Page Up/Down**: Navigate by page
- **Character keys**: Jump to option starting with character

### Native Select
- **Arrow Down/Up**: Navigate between options (macOS)
- **Alt + Arrow Down/Up**: Open dropdown (Windows/Linux)
- **Enter/Space**: Open dropdown
- **Escape**: Close dropdown (when open)

## Accessibility

### ARIA Attributes

- `role="combobox"` : Indicates this is a combobox
- `aria-expanded` : Indicates dropdown state
- `aria-haspopup="listbox"` : Indicates dropdown has listbox
- `aria-controls` : References the listbox ID
- `role="listbox"` : Dropdown list container
- `role="option"` : Individual options
- `aria-selected` : Selected option state
- `aria-activedescendant` : Currently focused option

### Screen Reader Support

- Full keyboard navigation
- Proper ARIA labels and descriptions
- Option descriptions read by screen readers
- Disabled options properly announced

## Integration Patterns

### Theme Selection

```tsx
const [selectedTheme, setSelectedTheme] = useState(0)
const themes = [
  { id: 'vs-dark', name: 'Visual Studio Dark', type: 'dark' },
  { id: 'vs-light', name: 'Visual Studio Light', type: 'light' },
  { id: 'monokai', name: 'Monokai', type: 'dark' }
]

const handleThemeChange = (data: ISelectData) => {
  const theme = themes[data.index]
  setSelectedTheme(data.index)
  applyTheme(theme.id)
}

<SelectBox
  selected={selectedTheme}
  options={themes.map(theme => ({
    text: `${theme.name} (${theme.type})`,
    description: `Theme ID: ${theme.id}`
  }))}
  onDidSelect={handleThemeChange}
  selectBoxOptions={{ 
    ariaLabel: 'Select theme',
    useCustomDrawn: true
  }}
/>
```

### Language Selection with Default Indicator

```tsx
const languages = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' }
]

const currentLanguage = 'en'

<SelectBox
  selected={languages.findIndex(lang => lang.code === currentLanguage)}
  options={languages.map(lang => ({
    text: lang.name,
    decoratorRight: lang.code === currentLanguage ? 'Default' : ''
  }))}
  onDidSelect={(data) => {
    const language = languages[data.index]
    setLanguage(language.code)
  }}
/>
```

### Settings with Validation

```tsx
const [selectedValue, setSelectedValue] = useState(0)
const [error, setError] = useState<string | null>(null)

const handleSelection = (data: ISelectData) => {
  setSelectedValue(data.index)
  setError(null)
  
  // Validate selection
  if (data.index === 2) {
    setError('This option is not recommended for production use')
  }
}

<SelectBox
  selected={selectedValue}
  options={[
    { text: 'Production', description: 'Stable release for production use' },
    { text: 'Beta', description: 'Beta release with new features' },
    { text: 'Alpha', description: 'Alpha release for testing only' }
  ]}
  onDidSelect={handleSelection}
  selectBoxOptions={{ 
    ariaLabel: 'Release channel',
    useCustomDrawn: true
  }}
/>

{error && (
  <div style={{ color: 'var(--errorForeground)', fontSize: '12px', marginTop: '4px' }}>
    {error}
  </div>
)}
```

## Performance Notes

### Optimization Techniques

- **Lazy Rendering**: Dropdown only renders when opened
- **Virtual Scrolling**: Long lists use ScrollableElement for performance
- **Memoization**: Options are memoized to prevent unnecessary re-renders
- **Event Delegation**: Efficient event handling for keyboard navigation

### Large Lists

For lists with 100+ options, consider:

```tsx
// Use ScrollableElement integration
<SelectBox
  options={largeOptionsList}
  selectBoxOptions={{ 
    useCustomDrawn: true, // Required for scrolling
    minBottomMargin: 32
  }}
/>
```

## Common Pitfalls

### 1. Missing useCustomDrawn for Descriptions

```tsx
// ❌ Descriptions won't show in native select
<SelectBox
  options={[
    { text: 'Option', description: 'This won\'t show' }
  ]}
/>

// ✅ Force custom dropdown to show descriptions
<SelectBox
  options={[
    { text: 'Option', description: 'This will show' }
  ]}
  selectBoxOptions={{ useCustomDrawn: true }}
/>
```

### 2. Incorrect Selected Index

```tsx
// ❌ Selected index out of bounds
<SelectBox
  options={[{ text: 'Option 1' }, { text: 'Option 2' }]}
  selected={5} // Index doesn't exist
/>

// ✅ Validate selected index
<SelectBox
  options={options}
  selected={Math.min(selectedIndex, options.length - 1)}
/>
```

### 3. Missing onDidSelect Handler

```tsx
// ❌ Selection changes won't be handled
<SelectBox
  options={options}
  selected={0}
/>

// ✅ Provide selection handler
<SelectBox
  options={options}
  selected={0}
  onDidSelect={(data) => setSelectedIndex(data.index)}
/>
```

## Troubleshooting

### Common Issues

1. **Dropdown not opening**: Check if `useCustomDrawn` is set correctly
2. **Descriptions not showing**: Ensure `useCustomDrawn: true` is set
3. **Styling not applied**: Verify CSS variables are defined in theme
4. **Keyboard navigation not working**: Check for conflicting event handlers

### Debug Tips

- Use browser dev tools to inspect dropdown DOM structure
- Check console for JavaScript errors
- Verify CSS classes are applied correctly
- Test with different `useCustomDrawn` values
- Check ARIA attributes for accessibility issues

## Notes for AI Usage

### Recommended Configuration

For optimal AI-generated code:

```typescript
// Always use theme variables
const defaultSelectBoxStyles: ISelectBoxStyles = {
  selectBackground: 'var(--settings-dropdownBackground)',
  selectForeground: 'var(--settings-dropdownForeground)',
  selectBorder: 'var(--settings-dropdownBorder)',
  listFocusBackground: 'var(--list-activeSelectionBackground)',
  listFocusForeground: 'var(--list-activeSelectionForeground)'
}
```

### Common Patterns for AI Generation

1. **Simple Selection**: Use basic options array with text only
2. **Rich Information**: Include descriptions and decorators
3. **Disabled Options**: Mark unavailable options as disabled
4. **Long Lists**: Use `useCustomDrawn: true` for scrolling
5. **Platform Consistency**: Let platform detection handle native vs custom

### Integration with State Management

```tsx
// With React state
const [selectedIndex, setSelectedIndex] = useState(0)

<SelectBox
  selected={selectedIndex}
  options={options}
  onDidSelect={(data) => setSelectedIndex(data.index)}
/>

// With external state management
<SelectBox
  selected={store.selectedIndex}
  options={store.options}
  onDidSelect={(data) => store.setSelectedIndex(data.index)}
/>
```

## Filtering long lists

When the popup contains at least `filterThreshold` items (default **15**, exposed as `DEFAULT_FILTER_THRESHOLD`), a sticky filter row appears at the top of the popup body:

- **Filter input** — auto-focused on open, case-insensitive substring match on the item label. `Esc` clears a non-empty filter; a second `Esc` (with the filter empty) closes the popup.
- **Select all / Deselect all** — only on multi-select dropdowns. They act on the *currently visible* slice, so combined with the filter the user can pick "filter + select all matching".
- **No matches** — when the filter eliminates every row, an italic placeholder is rendered in place of the list.

Per-instance opt-out: pass a `filterThreshold` larger than the item count (e.g. `Number.POSITIVE_INFINITY`).

The shared logic lives in `useFilterableDropdown` (see `hooks/useFilterableDropdown.ts`) and the row UI in `components/DropdownFilterRow`.
