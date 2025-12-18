# VSCode Themes Service

This document describes the implementation of the VSCode Themes Service in restorm, which allows the application to use official VSCode themes.

## Overview

The Themes Service provides:
- Support for all official VSCode themes (Monokai, Solarized, Abyss, etc.)
- Dynamic theme switching at runtime
- Automatic conversion of VSCode theme colors to CSS variables
- Theme persistence across sessions
- A test page to visualize all UI components with different themes

## Architecture

### Components

1. **ThemeService** (`src/main/services/ThemeService.ts`)
   - Main process service that loads and manages themes
   - Discovers themes from the resources folder
   - Parses VSCode theme JSON files
   - Converts theme colors to CSS variables

2. **IPC Handlers** (`src/main/index.ts`)
   - `theme:list` - Returns list of available themes
   - `theme:load` - Loads a specific theme with variables
   - `theme:get-current` - Gets the currently active theme
   - `theme:set` - Sets and persists a theme selection

3. **Preload API** (`src/preload/index.ts`)
   - Exposes theme API to renderer process
   - Type-safe interface for IPC communication

4. **useTheme Hook** (`src/renderer/src/hooks/useTheme.ts`)
   - React hook for managing themes in the UI
   - Automatically applies CSS variables to the DOM
   - Handles theme initialization and changes

5. **Theme Test Page** (`src/renderer/src/pages/ThemeTestPage.tsx`)
   - Comprehensive test page showing all UI components
   - Theme selector for easy testing
   - Demonstrates proper usage of CSS variables

## Theme Format

Themes are stored in `src/renderer/resources/themes/` with the following structure:

```
themes/
  theme-monokai/
    package.json          # Theme metadata
    themes/
      monokai-color-theme.json  # Theme definition
```

Each theme package contains:
- `package.json` - Metadata and theme contributions
- `themes/*.json` - Theme definition files

See [THEME_FORMAT.md](./THEME_FORMAT.md) for detailed format specification.

## Available Themes

The following official VSCode themes are included:

| Theme | Type | Description |
|-------|------|-------------|
| Dark+ (default dark) | dark | VSCode default dark theme |
| Light+ (default light) | light | VSCode default light theme |
| Dark High Contrast | hc | High contrast dark theme for accessibility |
| Light High Contrast | hcLight | High contrast light theme for accessibility |
| Monokai | dark | Classic Monokai color scheme |
| Monokai Dimmed | dark | Softer variant of Monokai |
| Solarized Dark | dark | Popular Solarized dark theme |
| Solarized Light | light | Popular Solarized light theme |
| Abyss | dark | Deep dark theme |
| Kimbie Dark | dark | Warm dark theme |
| Quiet Light | light | Soft light theme |
| Red | dark | Red accent dark theme |
| Tomorrow Night Blue | dark | Blue-tinted dark theme |

## Usage

### Using Themes in React Components

```typescript
import { useTheme } from '../hooks/useTheme'

function MyComponent() {
  const { themes, currentThemeId, setTheme } = useTheme()

  return (
    <div>
      <select 
        value={currentThemeId || ''} 
        onChange={(e) => setTheme(e.target.value)}
      >
        {themes.map(theme => (
          <option key={theme.id} value={theme.id}>
            {theme.name}
          </option>
        ))}
      </select>
    </div>
  )
}
```

### Using CSS Variables

All theme colors are available as CSS variables with the `--` prefix:

```css
.my-element {
  background-color: var(--editor-background);
  color: var(--editor-foreground);
  border: 1px solid var(--panel-border);
}
```

### Common CSS Variables

| Variable | Description |
|----------|-------------|
| `--editor-background` | Main editor background |
| `--editor-foreground` | Main editor text color |
| `--input-background` | Input field background |
| `--input-foreground` | Input field text color |
| `--input-border` | Input field border |
| `--button-background` | Primary button background |
| `--button-foreground` | Primary button text |
| `--button-hoverBackground` | Button hover state |
| `--dropdown-background` | Dropdown/select background |
| `--dropdown-border` | Dropdown/select border |
| `--list-activeSelectionBackground` | Selected list item |
| `--list-hoverBackground` | Hovered list item |
| `--panel-border` | Panel/section borders |
| `--sideBar-background` | Sidebar background |
| `--descriptionForeground` | Muted/description text |

## Testing

### Theme Test Page

The theme test page is accessible from the home screen via the "Theme Test" button. It displays:
- All input types (text, number, checkbox, radio)
- Buttons (primary, secondary, disabled)
- Dropdowns/selects
- Text areas
- Panels
- Lists
- Text variants

Use this page to visually verify that all components look correct with each theme.

### Playwright Tests

Two test suites are available:

1. **Visual Tests** (`e2e/theme-visual.spec.ts`)
   - Takes screenshots of each theme
   - Saves to `test-results/themes/`
   - Useful for visual regression testing

2. **Structure Tests** (`e2e/theme-structure.spec.ts`)
   - Verifies CSS variables are applied
   - Tests theme switching functionality
   - Checks data-theme attribute
   - Validates component styling

Run tests with:
```bash
pnpm test:e2e
```

## Adding a New Theme

To add a new VSCode theme:

1. Download the theme from the VSCode extensions repo or marketplace
2. Place it in `src/renderer/resources/themes/theme-{name}/`
3. Ensure it has a `package.json` with `contributes.themes`
4. Restart the application - the theme will be auto-discovered

Example package.json:
```json
{
  "name": "theme-my-theme",
  "displayName": "My Theme",
  "contributes": {
    "themes": [
      {
        "label": "My Theme",
        "uiTheme": "vs-dark",
        "path": "./themes/my-theme.json"
      }
    ]
  }
}
```

## Customizing Themes

### Overriding Colors

You can override specific colors by setting CSS variables after the theme is applied:

```typescript
document.documentElement.style.setProperty(
  '--editor-background',
  '#000000'
)
```

### Creating a Custom Theme

To create a fully custom theme:

1. Copy an existing theme folder
2. Modify the JSON file with your colors
3. Update the package.json metadata
4. Place in the themes directory

## Known Limitations

1. **Token Colors**: Syntax highlighting (tokenColors) is not yet implemented as restorm doesn't have a code editor component
2. **Semantic Tokens**: Semantic token colors are parsed but not currently used
3. **Theme Includes**: Themes that include other themes (like dark_plus.json includes dark_vs.json) are fully supported
4. **Comments in JSON**: VSCode themes often have comments; these are stripped during parsing

## Troubleshooting

### Theme not showing up

- Verify the theme folder structure matches the expected format
- Check that package.json has a valid `contributes.themes` section
- Look at the console for theme loading errors
- Ensure the theme JSON file is valid (no syntax errors)

### Colors not applying

- Check that CSS variables are being used (not hardcoded colors)
- Verify the theme actually defines the colors you're using
- Use browser DevTools to inspect computed styles
- Check that `data-theme` attribute is set on `<html>`

### Theme appears wrong

- Compare with VSCode to ensure the theme JSON is correct
- Check the theme test page to see all components
- Look for missing fallback colors
- Verify the theme type (dark/light/hc) is correct

## References

- [VSCode Theme Color Reference](https://code.visualstudio.com/api/references/theme-color)
- [VSCode Source Code](https://github.com/microsoft/vscode)
- [VSCode Extension API](https://code.visualstudio.com/api)
- [Color Theme Guide](https://code.visualstudio.com/api/extension-guides/color-theme)

## Future Enhancements

Potential improvements for the theme system:

1. **Theme Editor**: UI to customize theme colors
2. **Theme Import**: Import themes from .vsix files
3. **Custom Themes**: Create and save custom themes
4. **Theme Sharing**: Export/share theme configurations
5. **Auto Dark Mode**: Switch based on system preferences
6. **Per-Window Themes**: Different themes for different windows
7. **Theme Variants**: Light/dark variants of the same theme
