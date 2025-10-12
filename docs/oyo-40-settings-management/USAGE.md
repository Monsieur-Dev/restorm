# Settings Usage Guide

## How to Add New Settings

This guide explains how to add new settings to the application.

### Step 1: Define the Setting in the Schema

Edit `src/resources/settings-schema.json` and add your setting to the appropriate category.

#### Example: Adding a Boolean Setting

```json
{
  "categories": {
    "myCategory": {
      "key": "myCategory",
      "name": "My Category",
      "description": "Category description",
      "settings": {
        "myNewSetting": {
          "key": "myNewSetting",
          "name": "My New Setting",
          "description": "This is a new boolean setting",
          "type": "boolean",
          "defaultValue": true
        }
      }
    }
  }
}
```

#### Example: Adding a Range Setting (Slider)

```json
{
  "zoomLevel": {
    "key": "zoomLevel",
    "name": "Zoom Level",
    "description": "Adjust the zoom level between 50% and 200%",
    "type": "range",
    "defaultValue": 100,
    "min": 50,
    "max": 200,
    "step": 10
  }
}
```

### Step 2: Add Translations (Optional)

If your setting name or description should be translatable, add translation keys to:
- `src/renderer/locales/en/translation.json`
- `src/renderer/locales/fr/translation.json`

Example:
```json
{
  "settings": {
    "myNewSetting": {
      "name": "My New Setting",
      "description": "This is a new boolean setting"
    }
  }
}
```

Then reference these keys in your schema:
```json
{
  "name": "{{t:settings.myNewSetting.name}}",
  "description": "{{t:settings.myNewSetting.description}}"
}
```

**Note**: Currently, the schema uses plain strings. To implement i18n in the schema, you would need to add translation logic in the renderer.

### Step 3: Use the Setting in Your Code

#### In the Renderer Process

```typescript
// Get a setting value
const myValue = await window.settingsAPI.getSetting<boolean>('myCategory.myNewSetting')

// Set a setting value
await window.settingsAPI.setSetting('myCategory.myNewSetting', false)

// Reset to default
await window.settingsAPI.resetSetting('myCategory.myNewSetting')
```

#### React Hook Example

```typescript
import { useState, useEffect } from 'react'

function useSettings<T>(key: string): [T | undefined, (value: T) => Promise<void>] {
  const [value, setValue] = useState<T>()

  useEffect(() => {
    window.settingsAPI.getSetting<T>(key).then(setValue)
  }, [key])

  const updateValue = async (newValue: T) => {
    await window.settingsAPI.setSetting(key, newValue)
    setValue(newValue)
  }

  return [value, updateValue]
}

// Usage
function MyComponent() {
  const [zoomLevel, setZoomLevel] = useSettings<number>('workbench.appearance.zoomLevel')
  
  return (
    <div>
      Current zoom: {zoomLevel}%
      <button onClick={() => setZoomLevel(120)}>Set to 120%</button>
    </div>
  )
}
```

## Setting Types Reference

### Boolean

Use for on/off, true/false options.

```json
{
  "type": "boolean",
  "defaultValue": true
}
```

**Control**: Checkbox

### Number

Use for numeric values without constraints.

```json
{
  "type": "number",
  "defaultValue": 14
}
```

**Control**: Numeric input field

### String

Use for text values.

```json
{
  "type": "string",
  "defaultValue": "Hello World"
}
```

**Control**: Text input field

### Enum

Use for a fixed set of options.

```json
{
  "type": "enum",
  "defaultValue": "dark",
  "options": ["dark", "light", "high-contrast"]
}
```

**Control**: Dropdown select

### Range

Use for numeric values with minimum, maximum, and optional step.

```json
{
  "type": "range",
  "defaultValue": 100,
  "min": 50,
  "max": 200,
  "step": 10
}
```

**Control**: Slider with value display

**Properties**:
- `min`: Minimum value (required)
- `max`: Maximum value (required)
- `step`: Step increment (optional, defaults to 1)

## Hierarchical Settings

You can nest categories to create a hierarchy:

```json
{
  "categories": {
    "workbench": {
      "key": "workbench",
      "name": "Workbench",
      "categories": {
        "appearance": {
          "key": "appearance",
          "name": "Appearance",
          "settings": {
            "theme": {
              "key": "theme",
              "name": "Color Theme",
              "type": "enum",
              "defaultValue": "dark",
              "options": ["dark", "light"]
            }
          }
        }
      }
    }
  }
}
```

**Full path**: `workbench.appearance.theme`

## Best Practices

### 1. Choose Descriptive Keys

Use camelCase for keys and make them descriptive:
- Good: `autoSaveDelay`, `lineNumbers`, `fontSize`
- Bad: `as`, `ln`, `fs`

### 2. Provide Clear Descriptions

Write descriptions that explain:
- What the setting does
- When to use it
- Any side effects

Example:
```json
{
  "description": "Controls the delay in milliseconds after which an edited file is saved automatically. Set to 0 to disable auto-save."
}
```

### 3. Choose Appropriate Types

- **Boolean**: Binary choices (on/off, enabled/disabled)
- **Number**: Arbitrary numeric values (delays, counts, sizes without bounds)
- **String**: Text values (paths, names, custom formats)
- **Enum**: Fixed set of options (themes, modes, preset values)
- **Range**: Numeric values with clear min/max bounds (percentages, scales)

### 4. Set Sensible Defaults

Choose defaults that work for most users:
- Enable helpful features by default
- Use common values (font size: 14, zoom: 100%)
- Consider platform conventions

### 5. Organize Logically

Group related settings:
```
workbench/
  ├─ appearance/  (visual settings)
  ├─ editor/      (editor-specific)
  └─ behavior/    (functional settings)
```

### 6. Validate Values

The system validates automatically based on type, but consider:
- Enum: All possible values should be valid
- Range: Min < max, step divides range evenly
- Number: Consider if negative values make sense

## Special Settings

### Language Setting

The `workbench.appearance.language` setting is special:
- Changes are automatically applied to i18n
- UI re-renders with the new language
- Value must be a valid language code ('en' or 'fr')

To add a new language:
1. Add translation files in `src/renderer/locales/`
2. Update i18n configuration
3. Add language option to the enum

## Testing Your Settings

After adding a setting:

1. **Verify Schema Loading**: Check console for errors on app start
2. **Test UI**: Open settings and verify your setting appears
3. **Test Persistence**: Change the value, close and reopen settings
4. **Test Reset**: Use the reset button to restore default
5. **Test Search**: Search for your setting by name/description
6. **Test Validation**: Try invalid values (if applicable)

## Common Patterns

### Conditional Settings

If a setting should only be enabled when another setting is true, handle this in your component logic:

```typescript
function MyComponent() {
  const [featureEnabled] = useSettings<boolean>('myFeature.enabled')
  const [featureMode] = useSettings<string>('myFeature.mode')

  return (
    <div>
      {featureEnabled && <FeatureModeControl mode={featureMode} />}
    </div>
  )
}
```

### Settings with Side Effects

When a setting change should trigger an action:

```typescript
// In SettingsView.tsx
const handleSettingChange = useCallback(async (key: string, value: unknown) => {
  const success = await window.settingsAPI.setSetting(key, value)
  if (success) {
    setValues((prev) => ({ ...prev, [key]: value }))
    
    // Handle side effects
    if (key === 'workbench.appearance.language') {
      await i18n.changeLanguage(value as string)
    }
    // Add more side effects as needed
  }
}, [i18n])
```

### Default Value Computation

If a default value depends on runtime conditions, handle it in the service:

```typescript
// In SettingsService.ts
getSetting<T>(key: string): T | undefined {
  const setting = this.flattenedSettings.get(key)
  if (!setting) return undefined
  
  const userValue = this.storageService.get<T>(`${this.SETTINGS_KEY_PREFIX}${key}`)
  if (userValue !== undefined) return userValue
  
  // Compute default based on platform, etc.
  if (key === 'editor.fontFamily') {
    return (process.platform === 'darwin' 
      ? 'Menlo, Monaco' 
      : 'Consolas, Courier New') as T
  }
  
  return setting.defaultValue as T
}
```

## Troubleshooting

### Setting Doesn't Appear

1. Check JSON syntax in schema file
2. Verify the category structure is correct
3. Check console for schema loading errors
4. Ensure the setting has all required fields

### Setting Value Not Persisting

1. Check that the setting type matches the value type
2. Verify StorageService is working (check userData directory)
3. Look for validation errors in console
4. Ensure the full path key is correct

### Setting Control Not Working

1. Verify the control type matches the setting type
2. Check onChange handler is called
3. Look for validation errors when setting value
4. Verify IPC communication (check main process logs)

