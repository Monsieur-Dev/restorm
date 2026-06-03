# Button Components

Button components for React applications, providing consistent UI patterns and theming support.

## Overview

The Button component suite includes four main components:
- **Button**: Basic button with icon and label support
- **ButtonWithDescription**: Button with description text below
- **ButtonWithDropdown**: Button with dropdown menu for additional actions
- **ButtonWithIcon**: Button with icon and inline codicon label support

## Installation

```typescript
import { 
  Button, 
  ButtonWithDescription, 
  ButtonWithDropdown, 
  ButtonWithIcon,
  defaultButtonStyles 
} from 'electron-core-ui/renderer'
```

## Components

### Button

Basic button component with full theme styling and behavior.

#### Props

```typescript
interface ButtonProps {
  options?: IButtonOptions
  icon?: string | Icon  // string = codicon shorthand; Icon object = any IconView-supported library
  disabled?: boolean
  secondary?: boolean
  appearance?: 'default' | 'rainbow'
  size?: 'sm' | 'md' | 'default' | 'lg' | 'xl'  // 'md' = 28×28 square icon button
  /** Shorthand for `size="sm"` — convenient for compact toolbar / icon buttons. */
  small?: boolean
  /** Shorthand for `size="md"` — a 28×28 square icon button that lines up flush
   *  with a 28px-tall control (InputBox / SelectBox) inside a ControlGroup. */
  medium?: boolean
  line?: boolean
  /** Link appearance: no background, left-aligned text, trailing `codicon-link`
   *  glyph after the label. For inline "open / edit this item" affordances. */
  link?: boolean
  emphasis?: number
  fullWidth?: boolean
  backgroundColor?: string
  align?: 'left' | 'center' | 'right'
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void
  /** Right-click handler (the Button calls preventDefault for you) — e.g. an
   *  icon button that opens the same menu on primary and context click. */
  onContextMenu?: (event: React.MouseEvent<HTMLAnchorElement>) => void
  className?: string
  style?: React.CSSProperties
  id?: string
  /** ARIA role of the surface. Defaults to `'button'`. Set `'checkbox'`
   *  (with `aria-checked`) to reuse the Button surface as a toggle. */
  role?: React.AriaRole
  /** Checked state for a toggle/checkbox-role Button → `aria-checked`. */
  'aria-checked'?: boolean | 'false' | 'true' | 'mixed'
  /** Tab order override. Defaults to `0`, `-1` when disabled. */
  tabIndex?: number
  'data-testid'?: string
  children?: React.ReactNode
}
```

> **Toggle surface.** Pass `role="checkbox"` + `aria-checked` to reuse the themed Button as a small toolbar toggle (pressed/normal) instead of hand-styling a bare anchor — this is exactly how `Toggle`'s `appearance="button"` is built. Button's own keyboard handler toggles on Enter / Space, so the consumer only wires `onClick`.

#### Usage

Codicon shorthand:

```typescript
<Button icon="save" data-testid="save-button" onClick={() => doSave()}>
  Save
</Button>
```

Full `Icon` object (delegates rendering to `<IconView>` for any supported library):

```typescript
<Button icon={{ type: 'phosphor', value: 'rocket' }} onClick={launch}>
  Launch
</Button>

<Button icon={env.icon} onClick={pickEnv}>
  {env.name}
</Button>
```

##### `fullWidth`

Drops the default `max-width: 200px` cap on the button surface and stretches the wrapper to 100% of its parent. Use for popover rows, list entries, or any layout where the button **is** the row (not a chip inside it).

```typescript
<Button fullWidth secondary line onClick={pickEnv}>
  {env.name}
</Button>
```

##### `backgroundColor`

Inline background applied to the button surface. Wins over the variant's CSS `--button-*` tokens. Use for swatches / tinted list rows where the row's color is part of the data — env color, tag color, status pill, etc. — rather than a theme variant.

```typescript
<Button
  fullWidth
  secondary
  line
  backgroundColor={envGradient(env.color)}
  onClick={pickEnv}
>
  {env.name}
</Button>
```

##### `align`

Horizontal alignment of the label. Defaults to `'center'` (CTA-style). `'left'` makes the label hug the leading edge — the natural pick for `fullWidth` list rows or popover entries.

```typescript
<Button fullWidth secondary line align="left" onClick={pickEnv}>
  {env.name}
</Button>
```

##### `appearance` and `size`

`appearance` selects the rendered surface; `size` scales padding / typography. Click and keyboard contracts are identical across appearances.

| Appearance  | What it looks like |
| ----------- | ------------------ |
| `'default'` | Standard codicon-friendly button (theme tokens, `secondary`/`emphasis`/`backgroundColor` apply). |
| `'rainbow'` | Hero CTA — solid dark surface (`#121213`) with an animated rainbow gradient border pinned to the bottom edge and a soft glow underneath, revealed on hover/focus-visible. `secondary`/`emphasis`/codicon modifiers do **not** apply (rainbow paints its own surface). |

| Size        | Typography / padding | Use for |
| ----------- | -------------------- | ------- |
| `'sm'`      | 13px / 8×16          | Inline secondary actions, popover rows. (Alias for legacy `small`.) |
| `'default'` | 14px / 10×20         | Standard call-to-action. |
| `'lg'`      | 16px / 14×28         | Section CTA. |
| `'xl'`      | 20px / 20×40         | Hero CTA on welcome / landing surfaces. |

```typescript
// Hero CTA on a welcome screen
<Button
  appearance="rainbow"
  size="xl"
  onClick={onNew}
  options={{ ariaLabel: 'Create a new collection' }}
>
  New
</Button>

// Section CTA — default appearance, large size
<Button size="lg" emphasis={1} onClick={onSubmit}>
  Submit
</Button>
```

The animated rainbow gradient + glow are paused at rest and run only on hover / focus-visible, so the button is calm in idle and lights up when interacted with. The full animation honors `prefers-reduced-motion: reduce`.

### ButtonWithDescription

Button with description text displayed below the main button.

#### Props

```typescript
interface ButtonWithDescriptionProps {
  options?: IButtonOptions
  description: string
  icon?: string
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void
  className?: string
  id?: string
  'data-testid'?: string
  children?: React.ReactNode
}
```

#### Usage

```typescript
<ButtonWithDescription
  description="Deploy to production environment"
  icon="rocket"
  data-testid="deploy-button"
  onClick={() => deploy()}
>
  Deploy
</ButtonWithDescription>
```

### ButtonWithDropdown

Button with dropdown menu for additional actions.

#### Props

```typescript
interface ButtonWithDropdownProps {
  options: IButtonWithDropdownOptions
  label: string
  icon?: string
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void
  className?: string
  id?: string
  'data-testid'?: string
}
```

#### Usage

```typescript
<ButtonWithDropdown
  options={{
    disabled: false,
    actions: [
      { label: 'Save', onClick: () => save() },
      { label: 'Save As...', onClick: () => saveAs() },
      { label: 'Export', onClick: () => exportFile() }
    ]
  }}
  label="File"
  data-testid="file-dropdown"
  onClick={() => save()}
/>
```

### ButtonWithIcon

Button helper that renders an inline codicon prefix: `$(${icon}) ${label}`.

#### Props

```typescript
interface ButtonWithIconProps {
  options: IButtonOptions
  icon: string
  label: string
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void
  className?: string
  id?: string
  'data-testid'?: string
}
```

#### Usage

```typescript
<ButtonWithIcon
  options={{ disabled: false }}
  icon="play"
  label="Start Process"
  data-testid="start-button"
  onClick={() => start()}
/>
```

## Options Interface

### IButtonOptions

```typescript
interface IButtonOptions extends Partial<IButtonStyles> {
  readonly title?: boolean | string;
  readonly ariaLabel?: string;
  readonly supportIcons?: boolean;
  readonly supportShortLabel?: boolean;
  readonly secondary?: boolean;
  readonly disabled?: boolean;
}
```

### IButtonStyles

```typescript
interface IButtonStyles {
  readonly buttonBackground: string | undefined;
  readonly buttonHoverBackground: string | undefined;
  readonly buttonForeground: string | undefined;
  readonly buttonSeparator: string | undefined;
  readonly buttonSecondaryBackground: string | undefined;
  readonly buttonSecondaryHoverBackground: string | undefined;
  readonly buttonSecondaryForeground: string | undefined;
  readonly buttonBorder: string | undefined;
}
```

## Notes for AI Usage

- Prefer **controlled callbacks** (`onClick`) that delegate to small, pure functions; avoid embedding side effects or navigation logic inline in JSX so agents can more easily reuse or reorder actions.
- Keep `options` objects stable (memoized) when toggling only a few flags (like `disabled`), to minimize unnecessary re-renders and make button state derivation easier to reason about.
- When generating buttons programmatically, separate **semantic meaning** (e.g. `actionId`, `intent`) from visual labels and icons so that agents can choose or replace actions without breaking the layout.

## Styling

### CSS Variables

The components use theme CSS variables for theming:

- `--button-foreground`
- `--button-background`
- `--button-hoverBackground`
- `--button-secondaryForeground`
- `--button-secondaryBackground`
- `--button-secondaryHoverBackground`
- `--button-border`
- `--button-separator`

### CSS Classes

- `.button` - Base button class
- `.text-button` - Text button variant
- `.button-dropdown` - Dropdown container
- `.description-button` - Button with description
- `.button.disabled` - Disabled state
- `.default-colors` - CSS variable-based theming

## Features

### Icon Support

Icons are supported via Codicons. Use the `icon` prop or include icons in labels:

```typescript
// Via icon prop
<Button icon="save">Save</Button>

// Via children with icon syntax
<Button>$(save) Save File</Button>
```

### Keyboard Navigation

- **Enter/Space**: Trigger button click
- **Escape**: Blur button (for dropdowns)
- **Tab**: Navigate between buttons

### Accessibility

- ARIA labels support
- Keyboard navigation
- Screen reader friendly
- Focus management

## Examples

### Basic Button

```typescript
<Button
  data-testid="click-me"
  onClick={() => doSomething()}
>
  Click Me
</Button>
```

### Secondary Button

```typescript
<Button
  secondary
  data-testid="cancel-button"
  onClick={() => cancel()}
>
  Cancel
</Button>
```

### Button with Dropdown

```typescript
<ButtonWithDropdown
  data-testid="new-dropdown"
  options={{
    actions: [
      { label: 'New File', onClick: () => createFile() },
      { label: 'New Folder', onClick: () => createFolder() },
      { label: 'Import', onClick: () => importFiles() }
    ]
  }}
  label="New"
  icon="add"
  onClick={() => createFile()}
/>
```

### Button with Description

```typescript
<ButtonWithDescription
  data-testid="deploy"
  description="Deploy current changes to production"
  icon="rocket"
  onClick={() => deploy()}
>
  Deploy
</ButtonWithDescription>
```

## Testing

### Recommended stable hooks

Buttons are rendered as `<a role="button">`.

- Disabled state uses `aria-disabled="true"` and `tabIndex={-1}`.
- The base `Button` supports `'data-testid'`.
- `ButtonWithDescription`, `ButtonWithIcon`, and `ButtonWithDropdown` also support `'data-testid'`.

For `ButtonWithDropdown`, the following sub-elements are tagged when `data-testid` is provided:

- Primary action: `${testId}-primary`
- Toggle button: `${testId}-toggle`
- Menu: `${testId}-menu`
- Actions: `${testId}-action-0`, `${testId}-action-1`, ...

### E2E helpers

`electron-core-ui/testing` exports selector helpers:

- `buttonTestIdSelector(testId)`
- `buttonAnchorSelector(testId)`
- `buttonDropdownPrimarySelector(testId)`
- `buttonDropdownToggleSelector(testId)`
- `buttonDropdownMenuSelector(testId)`
- `buttonDropdownActionByIndexSelector(testId, index)`

### Playwright-BDD steps

`electron-core-ui/testing/playwright-bdd` exports `defineButtonBddSteps(bdd)`.
It registers generic steps such as:

- `When I click button {string}`
- `When I press {string} on button {string}`
- `Then button {string} should be disabled`
- `Then button {string} should contain codicon {string}`
- `When I open dropdown {string}`
- `When I click dropdown {string} action index {int}`
- `Then dropdown {string} should be closed`

## Best Practices

1. **Use appropriate button types**: Primary for main actions, secondary for alternatives
2. **Provide clear labels**: Use descriptive text that explains the action
3. **Use icons consistently**: Follow the icon patterns
4. **Handle disabled states**: Provide visual feedback for unavailable actions
5. **Test keyboard navigation**: Ensure all buttons are accessible via keyboard
6. **Use dropdowns sparingly**: Only when you have multiple related actions

## Troubleshooting

### Common Issues

1. **Icons not displaying**: Ensure codicon CSS is loaded
2. **Styling not applied**: Check that CSS variables are defined
3. **Dropdown not closing**: Verify click outside handling is working
4. **Keyboard navigation issues**: Check tabIndex and event handlers

### Debug Tips

- Use browser dev tools to inspect CSS classes
- Check console for JavaScript errors
- Verify CSS variables are loaded
- Test with keyboard navigation
