# VSCode Theme Format

This document describes the structure and format of VSCode theme files used in Gitable.

## Theme Package Structure

A theme package consists of:

```
theme-name/
├── package.json              # Theme metadata and contributions
├── cgmanifest.json          # Optional: Component governance manifest
├── package.nls.json         # Optional: Localized strings
└── themes/
    ├── theme-name.json      # Main theme definition
    └── ...                  # Additional theme variants
```

## package.json

The package.json defines theme metadata and contributions:

```json
{
  "name": "theme-monokai",
  "displayName": "Monokai",
  "description": "Monokai color theme",
  "version": "1.0.0",
  "publisher": "vscode",
  "license": "MIT",
  "contributes": {
    "themes": [
      {
        "label": "Monokai",
        "uiTheme": "vs-dark",
        "path": "./themes/monokai-color-theme.json"
      }
    ]
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Package identifier |
| `displayName` | string | Human-readable name |
| `contributes.themes` | array | List of theme contributions |
| `themes[].label` | string | Display name in theme picker |
| `themes[].uiTheme` | string | Base UI theme (`vs`, `vs-dark`, `hc-black`, `hc-light`) |
| `themes[].path` | string | Path to theme JSON file |

### uiTheme Values

| Value | Description | Maps to Type |
|-------|-------------|--------------|
| `vs` | Light theme | `light` |
| `vs-dark` | Dark theme | `dark` |
| `hc-black` | High contrast dark | `hc` |
| `hc-light` | High contrast light | `hcLight` |

## Theme Definition File

The main theme definition is a JSON file with the following structure:

```json
{
  "$schema": "vscode://schemas/color-theme",
  "name": "Monokai",
  "type": "dark",
  "colors": {
    "editor.background": "#272822",
    "editor.foreground": "#f8f8f2",
    ...
  },
  "tokenColors": [
    {
      "name": "Comment",
      "scope": "comment",
      "settings": {
        "foreground": "#88846f"
      }
    },
    ...
  ],
  "semanticTokenColors": {
    "variable": "#f8f8f2",
    ...
  },
  "semanticHighlighting": true
}
```

### Root Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `$schema` | string | No | JSON schema reference |
| `name` | string | Yes | Theme name |
| `type` | string | No | Theme type: `dark`, `light`, `hc` |
| `include` | string | No | Path to base theme to inherit from |
| `colors` | object | Yes | UI color definitions |
| `tokenColors` | array | No | Syntax token color rules |
| `semanticTokenColors` | object | No | Semantic token colors |
| `semanticHighlighting` | boolean | No | Enable semantic highlighting |

## Colors Object

The `colors` object defines colors for all UI elements. Each key is a color identifier, and the value is a color string.

### Color Format

Colors can be specified as:
- Hex: `"#RRGGBB"` or `"#RRGGBBAA"`
- Hex with alpha: `"#272822"` or `"#27282280"` (80 = 50% opacity)

### Commonly Used Color Keys

#### Editor Colors

```json
{
  "editor.background": "#1E1E1E",
  "editor.foreground": "#D4D4D4",
  "editor.lineHighlightBackground": "#2A2A2A",
  "editor.selectionBackground": "#264F78",
  "editor.selectionHighlightBackground": "#ADD6FF26",
  "editor.inactiveSelectionBackground": "#3A3D41",
  "editor.wordHighlightBackground": "#575757B8",
  "editorLineNumber.foreground": "#858585",
  "editorLineNumber.activeForeground": "#C6C6C6",
  "editorCursor.foreground": "#AEAFAD",
  "editorWhitespace.foreground": "#404040",
  "editorIndentGuide.background": "#404040",
  "editorIndentGuide.activeBackground": "#707070"
}
```

#### Input Controls

```json
{
  "input.background": "#3C3C3C",
  "input.foreground": "#CCCCCC",
  "input.border": "#3C3C3C",
  "input.placeholderForeground": "#A6A6A6",
  "inputOption.activeBorder": "#007ACC",
  "inputValidation.errorBackground": "#5A1D1D",
  "inputValidation.errorBorder": "#BE1100"
}
```

#### Buttons

```json
{
  "button.background": "#0E639C",
  "button.foreground": "#FFFFFF",
  "button.hoverBackground": "#1177BB",
  "button.secondaryBackground": "#3A3D41",
  "button.secondaryForeground": "#CCCCCC",
  "button.secondaryHoverBackground": "#45494E"
}
```

#### Dropdowns

```json
{
  "dropdown.background": "#3C3C3C",
  "dropdown.foreground": "#CCCCCC",
  "dropdown.border": "#3C3C3C",
  "dropdown.listBackground": "#252526"
}
```

#### Checkboxes

```json
{
  "checkbox.background": "#3C3C3C",
  "checkbox.foreground": "#CCCCCC",
  "checkbox.border": "#3C3C3C"
}
```

#### Lists & Trees

```json
{
  "list.activeSelectionBackground": "#0E639C",
  "list.activeSelectionForeground": "#FFFFFF",
  "list.inactiveSelectionBackground": "#37373D",
  "list.hoverBackground": "#2A2D2E",
  "list.focusBackground": "#062F4A",
  "list.highlightForeground": "#0097FB"
}
```

#### Sidebar

```json
{
  "sideBar.background": "#252526",
  "sideBar.foreground": "#CCCCCC",
  "sideBar.border": "#3C3C3C",
  "sideBarTitle.foreground": "#BBBBBB",
  "sideBarSectionHeader.background": "#00000000",
  "sideBarSectionHeader.border": "#CCCCCC33"
}
```

#### Panels & Borders

```json
{
  "panel.background": "#1E1E1E",
  "panel.border": "#3C3C3C",
  "panelTitle.activeBorder": "#0E639C",
  "panelTitle.activeForeground": "#E7E7E7",
  "panelTitle.inactiveForeground": "#E7E7E799"
}
```

#### Status Bar

```json
{
  "statusBar.background": "#007ACC",
  "statusBar.foreground": "#FFFFFF",
  "statusBar.noFolderBackground": "#68217A",
  "statusBar.debuggingBackground": "#CC6633"
}
```

#### Activity Bar

```json
{
  "activityBar.background": "#333333",
  "activityBar.foreground": "#FFFFFF",
  "activityBar.inactiveForeground": "#FFFFFF66",
  "activityBarBadge.background": "#007ACC",
  "activityBarBadge.foreground": "#FFFFFF"
}
```

#### Tabs

```json
{
  "tab.activeBackground": "#1E1E1E",
  "tab.activeForeground": "#FFFFFF",
  "tab.inactiveBackground": "#2D2D2D",
  "tab.inactiveForeground": "#FFFFFF80",
  "tab.border": "#252526"
}
```

### Complete Color Reference

For a complete list of all available color keys, see:
https://code.visualstudio.com/api/references/theme-color

## Token Colors

Token colors define syntax highlighting for code. Each rule matches text by scope and applies formatting.

### Token Color Rule Structure

```json
{
  "name": "Comment",           // Optional: description
  "scope": "comment",          // Scope selector (string or array)
  "settings": {
    "foreground": "#6A9955",   // Text color
    "fontStyle": "italic"      // Optional: bold, italic, underline
  }
}
```

### Common Scopes

| Scope | Description |
|-------|-------------|
| `comment` | Comments |
| `string` | String literals |
| `constant.numeric` | Numbers |
| `constant.language` | Language constants (true, false, null) |
| `keyword` | Keywords (if, for, class) |
| `keyword.control` | Control flow keywords |
| `storage.type` | Type keywords (int, void) |
| `entity.name.function` | Function names |
| `entity.name.type` | Type/class names |
| `variable` | Variables |
| `variable.parameter` | Function parameters |
| `support.function` | Built-in functions |
| `invalid` | Invalid/error text |

### Font Styles

| Style | Description |
|-------|-------------|
| `"bold"` | Bold text |
| `"italic"` | Italic text |
| `"underline"` | Underlined text |
| `"bold italic"` | Combination |

## Theme Inheritance

Themes can inherit from other themes using the `include` property:

```json
{
  "$schema": "vscode://schemas/color-theme",
  "name": "Dark+",
  "include": "./dark_vs.json",
  "tokenColors": [
    // Override or add token colors
  ]
}
```

When a theme includes another:
1. Base theme is loaded first
2. Colors are merged (current theme overrides base)
3. Token colors are concatenated (base + current)
4. Semantic token colors are merged

## Semantic Token Colors

Semantic token colors provide additional syntax coloring based on semantic analysis:

```json
{
  "semanticTokenColors": {
    "variable": "#9CDCFE",
    "variable.readonly": "#4FC1FF",
    "parameter": "#9CDCFE",
    "function": "#DCDCAA",
    "method": "#DCDCAA",
    "class": "#4EC9B0",
    "interface": "#4EC9B0",
    "type": "#4EC9B0",
    "namespace": "#4EC9B0",
    "property": "#9CDCFE",
    "enum": "#4EC9B0",
    "enumMember": "#4FC1FF"
  }
}
```

**Note**: Gitable currently parses but doesn't use semantic token colors as it doesn't have a code editor component.

## Converting to CSS Variables

The ThemeService automatically converts theme colors to CSS variables:

| Theme Key | CSS Variable |
|-----------|--------------|
| `editor.background` | `--editor-background` |
| `editor.foreground` | `--editor-foreground` |
| `input.background` | `--input-background` |
| `button.background` | `--button-background` |

The conversion rule: Replace dots with dashes and prefix with `--`.

## Example: Complete Minimal Theme

```json
{
  "$schema": "vscode://schemas/color-theme",
  "name": "My Theme",
  "type": "dark",
  "colors": {
    "editor.background": "#1E1E1E",
    "editor.foreground": "#D4D4D4",
    "input.background": "#3C3C3C",
    "input.foreground": "#CCCCCC",
    "input.border": "#3C3C3C",
    "button.background": "#0E639C",
    "button.foreground": "#FFFFFF",
    "dropdown.background": "#3C3C3C",
    "dropdown.foreground": "#CCCCCC",
    "list.activeSelectionBackground": "#0E639C",
    "list.hoverBackground": "#2A2D2E",
    "sideBar.background": "#252526",
    "panel.border": "#3C3C3C"
  },
  "tokenColors": [
    {
      "scope": "comment",
      "settings": {
        "foreground": "#6A9955"
      }
    },
    {
      "scope": "string",
      "settings": {
        "foreground": "#CE9178"
      }
    },
    {
      "scope": "keyword",
      "settings": {
        "foreground": "#569CD6"
      }
    }
  ]
}
```

## Validation

Themes are validated during loading:
- JSON must be well-formed (no syntax errors)
- Comments are automatically stripped
- Missing colors fall back to defaults
- Invalid color values are logged as warnings

## Resources

- [VSCode Theme Color Reference](https://code.visualstudio.com/api/references/theme-color)
- [TextMate Scopes](https://macromates.com/manual/en/language_grammars#naming_conventions)
- [VSCode Theme Guide](https://code.visualstudio.com/api/extension-guides/color-theme)
- [Theme Extension Samples](https://github.com/microsoft/vscode-extension-samples/tree/main/theme-sample)
