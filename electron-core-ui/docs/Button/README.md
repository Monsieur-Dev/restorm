# Button Components

VSCode-style button components for React applications, providing consistent UI patterns and theming support.

## Overview

The Button component suite includes four main components:
- **Button**: Basic button with icon and label support
- **ButtonWithDescription**: Button with description text below
- **ButtonWithDropdown**: Button with dropdown menu for additional actions
- **ButtonWithIcon**: Button with icon and markdown label support

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

Basic button component with full VSCode styling and behavior.

#### Props

```typescript
interface ButtonProps {
  options: IButtonOptions;
  label?: string;
  icon?: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  id?: string;
}
```

#### Usage

```typescript
<Button
  options={{
    secondary: false,
    disabled: false,
    supportIcons: true
  }}
  label="Save"
  icon="save"
  onClick={() => console.log('Saved!')}
/>
```

### ButtonWithDescription

Button with description text displayed below the main button.

#### Props

```typescript
interface ButtonWithDescriptionProps {
  options: IButtonOptions;
  label: string;
  description: string;
  icon?: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  id?: string;
}
```

#### Usage

```typescript
<ButtonWithDescription
  options={{
    secondary: false,
    disabled: false
  }}
  label="Deploy"
  description="Deploy to production environment"
  icon="rocket"
  onClick={() => console.log('Deploying...')}
/>
```

### ButtonWithDropdown

Button with dropdown menu for additional actions.

#### Props

```typescript
interface ButtonWithDropdownProps {
  options: IButtonWithDropdownOptions;
  label: string;
  icon?: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  id?: string;
}
```

#### Usage

```typescript
<ButtonWithDropdown
  options={{
    secondary: false,
    disabled: false,
    actions: [
      { label: 'Save', onClick: () => console.log('Save') },
      { label: 'Save As...', onClick: () => console.log('Save As') },
      { label: 'Export', onClick: () => console.log('Export') }
    ]
  }}
  label="File"
  onClick={() => console.log('Primary action')}
/>
```

### ButtonWithIcon

Button with icon and markdown label support.

#### Props

```typescript
interface ButtonWithIconProps {
  options: IButtonOptions;
  icon: string;
  label: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  id?: string;
}
```

#### Usage

```typescript
<ButtonWithIcon
  options={{
    secondary: false,
    disabled: false
  }}
  icon="play"
  label="$(play) Start Process"
  onClick={() => console.log('Starting...')}
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

The components use VSCode CSS variables for theming:

- `--vscode-button-foreground`
- `--vscode-button-background`
- `--vscode-button-hoverBackground`
- `--vscode-button-secondaryForeground`
- `--vscode-button-secondaryBackground`
- `--vscode-button-secondaryHoverBackground`
- `--vscode-button-border`
- `--vscode-button-separator`

### CSS Classes

- `.monaco-button` - Base button class
- `.monaco-text-button` - Text button variant
- `.monaco-button-dropdown` - Dropdown container
- `.monaco-description-button` - Button with description
- `.monaco-button.disabled` - Disabled state
- `.default-colors` - CSS variable-based theming

## Features

### Icon Support

Icons are supported via Codicons. Use the `icon` prop or include icons in labels:

```typescript
// Via icon prop
<Button icon="save" label="Save" />

// Via label with icon syntax
<Button label="$(save) Save File" />
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
  options={{ disabled: false }}
  label="Click Me"
  onClick={() => alert('Clicked!')}
/>
```

### Secondary Button

```typescript
<Button
  options={{ secondary: true }}
  label="Cancel"
  onClick={() => console.log('Cancelled')}
/>
```

### Button with Dropdown

```typescript
<ButtonWithDropdown
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
  options={{ secondary: false }}
  label="Deploy"
  description="Deploy current changes to production"
  icon="rocket"
  onClick={() => deploy()}
/>
```

## Best Practices

1. **Use appropriate button types**: Primary for main actions, secondary for alternatives
2. **Provide clear labels**: Use descriptive text that explains the action
3. **Use icons consistently**: Follow VSCode's icon patterns
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
