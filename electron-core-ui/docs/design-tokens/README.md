# Design Tokens System

This document describes the CSS variable naming conventions and contrast rules for the electron-core-ui theming system.

## Overview

Design tokens are the visual design atoms of the design system — specifically, they are named entities that store visual design attributes. We use CSS custom properties (variables) to implement these tokens.

## Token Naming Convention

All color tokens follow the pattern: `--{category}-{element}-{property}`

### Categories

| Category | Description | Example |
|----------|-------------|---------|
| `editor` | Editor area | `--editor-background` |
| `input` | Form inputs | `--input-foreground` |
| `button` | Buttons | `--button-background` |
| `list` | Lists and trees | `--list-hoverBackground` |
| `dropdown` | Dropdowns and selects | `--dropdown-border` |
| `tab` | Tab elements | `--tab-activeForeground` |
| `menu` | Menus and context menus | `--menu-selectionBackground` |
| `statusBar` | Status bar | `--statusBar-background` |
| `titleBar` | Title bar | `--titleBar-activeForeground` |
| `sideBar` | Side bar / explorer | `--sideBar-background` |
| `panel` | Bottom panel | `--panel-border` |
| `activityBar` | Activity bar | `--activityBar-foreground` |
| `scrollbar` | Scrollbars | `--scrollbarSlider-background` |
| `badge` | Badges and counters | `--badge-background` |
| `tag` | Tags | `--tag-foreground` |
| `terminal` | Terminal colors | `--terminal-ansiRed` |

### Properties

| Property | Description |
|----------|-------------|
| `background` | Background color |
| `foreground` | Text/icon color |
| `border` | Border color |
| `hoverBackground` | Hover state background |
| `activeBackground` | Active/selected state background |
| `activeForeground` | Active/selected state foreground |
| `inactiveBackground` | Inactive state background |
| `inactiveForeground` | Inactive state foreground |

---

## Foreground/Background Pairs

These are the defined pairs where a foreground color MUST have sufficient contrast with its associated background.

### Critical Pairs (Must have WCAG AA contrast ratio ≥ 4.5:1)

| Foreground Token | Background Token | Usage |
|-----------------|------------------|-------|
| `editor.foreground` | `editor.background` | Main editor text |
| `foreground` | `editor.background` | Generic text on editor |
| `input.foreground` | `input.background` | Input field text |
| `input.placeholderForeground` | `input.background` | Input placeholder |
| `button.foreground` | `button.background` | Primary button text |
| `button.secondaryForeground` | `button.secondaryBackground` | Secondary button text |
| `list.foreground` | `editor.background` | List item text |
| `list.activeSelectionForeground` | `list.activeSelectionBackground` | Selected list item |
| `list.hoverForeground` | `list.hoverBackground` | Hovered list item |
| `list.focusForeground` | `list.focusBackground` | Focused list item |
| `dropdown.foreground` | `dropdown.background` | Dropdown text |
| `menu.foreground` | `menu.background` | Menu item text |
| `tab.activeForeground` | `tab.activeBackground` | Active tab text |
| `tab.inactiveForeground` | `tab.inactiveBackground` | Inactive tab text |
| `statusBar.foreground` | `statusBar.background` | Status bar text |
| `titleBar.activeForeground` | `titleBar.activeBackground` | Title bar text |
| `sideBar.foreground` | `sideBar.background` | Side bar text |
| `sideBarTitle.foreground` | `sideBar.background` | Side bar title |
| `panel.foreground` | `panel.background` | Panel text |
| `panelTitle.activeForeground` | `panel.background` | Panel title |
| `activityBar.foreground` | `activityBar.background` | Activity bar icons |
| `editorWidget.foreground` | `editorWidget.background` | Widget text |
| `editorHoverWidget.foreground` | `editorHoverWidget.background` | Hover tooltip text |
| `quickInput.foreground` | `quickInput.background` | Quick input text |
| `badge.foreground` | `badge.background` | Badge text |
| `tag.foreground` | `tag.background` | Tag text |
| `checkbox.foreground` | `checkbox.background` | Checkbox text |
| `terminal.foreground` | `editor.background` | Terminal text |

### Decorative Pairs (Minimum contrast ratio ≥ 3:1)

| Foreground Token | Background Token | Usage |
|-----------------|------------------|-------|
| `descriptionForeground` | `editor.background` | Secondary/description text |
| `focusBorder` | `editor.background` | Focus indicators |
| `editorLineNumber.foreground` | `editor.background` | Line numbers |
| `editorLineNumber.activeForeground` | `editor.background` | Active line number |

---

## Theme Type Defaults

### Dark Themes

```yaml
editor.background: "#1e1e1e"
editor.foreground: "#d4d4d4"
foreground: "#d4d4d4"
```

### Light Themes

```yaml
editor.background: "#ffffff"
editor.foreground: "#3b3b3b"
foreground: "#3b3b3b"
```

### High Contrast Dark

```yaml
editor.background: "#000000"
editor.foreground: "#ffffff"
foreground: "#ffffff"
```

### High Contrast Light

```yaml
editor.background: "#ffffff"
editor.foreground: "#000000"
foreground: "#000000"
```

---

## Contrast Requirements

### WCAG 2.1 Guidelines

| Level | Ratio | Use Case |
|-------|-------|----------|
| AA (Normal text) | ≥ 4.5:1 | Body text, labels |
| AA (Large text) | ≥ 3:1 | Headings 18pt+, bold 14pt+ |
| AAA (Normal text) | ≥ 7:1 | Enhanced accessibility |
| AAA (Large text) | ≥ 4.5:1 | Enhanced for large text |

### Our Requirements

- **Text on backgrounds**: Minimum 4.5:1 (WCAG AA)
- **UI components** (borders, icons): Minimum 3:1
- **High Contrast themes**: Minimum 7:1 (WCAG AAA)

---

## Validation

Run the contrast validator to check all themes:

```bash
npm run validate:contrast
```

This will:
1. Load all theme definitions
2. Check each foreground/background pair
3. Report any contrast violations
4. Exit with error code if violations found (for CI integration)

---

## Adding New Tokens

When adding new color tokens:

1. **Identify the category** - What UI element does it belong to?
2. **Define the pair** - Every foreground needs a background
3. **Add to contrast pairs** - Update `scripts/validate-contrast.ts`
4. **Document** - Add to this file
5. **Test** - Run `npm run validate:contrast`

### Example

```yaml
# In dark/_base.yaml
colors:
  - id: myComponent.background
    value: "#252526"
    description: My component background
    
  - id: myComponent.foreground
    value: "#cccccc"
    description: My component text color
```

Then add to `CONTRAST_PAIRS` in validate-contrast.ts:

```typescript
{ fg: 'myComponent.foreground', bg: 'myComponent.background', minRatio: 4.5 }
```
