# Settings Schema Documentation

## Overview

The settings schema defines the structure, types, and metadata for all application settings. It is stored in a JSON file at `src/resources/settings-schema.json`.

## Schema Structure

The schema follows a hierarchical structure with categories, subcategories, and settings.

### Root Schema

```json
{
  "categories": {
    "categoryKey": { ... }
  }
}
```

The root object contains a single `categories` property with a record of category definitions.

## Category Definition

A category can contain subcategories and/or settings.

### Structure

```json
{
  "key": "string",           // Required: Unique identifier
  "name": "string",          // Required: Display name
  "description": "string",   // Optional: Category description
  "categories": {            // Optional: Nested categories
    "subCategoryKey": { ... }
  },
  "settings": {              // Optional: Settings in this category
    "settingKey": { ... }
  }
}
```

### Properties

- **key** (string, required): Unique identifier for the category, used in the full path
- **name** (string, required): Human-readable name displayed in the UI
- **description** (string, optional): Brief description of the category
- **categories** (object, optional): Nested categories
- **settings** (object, optional): Settings in this category

### Example

```json
{
  "workbench": {
    "key": "workbench",
    "name": "Workbench",
    "description": "Customize the appearance and behavior of the workbench",
    "categories": {
      "appearance": { ... }
    }
  }
}
```

## Setting Definition

A setting defines a configurable value with its type, default, and metadata.

### Base Properties

All settings share these base properties:

```json
{
  "key": "string",           // Required: Unique identifier
  "name": "string",          // Required: Display name
  "description": "string",   // Required: Setting description
  "type": "string",          // Required: Setting type
  "defaultValue": any        // Required: Default value
}
```

- **key** (string, required): Unique identifier within the category
- **name** (string, required): Human-readable name
- **description** (string, required): Explanation of what the setting does
- **type** (string, required): One of: "boolean", "number", "string", "enum", "range"
- **defaultValue** (required): Default value, type depends on setting type

### Setting Types

#### Boolean

For true/false, on/off options.

```json
{
  "key": "myBoolean",
  "name": "My Boolean Setting",
  "description": "Enable or disable this feature",
  "type": "boolean",
  "defaultValue": true
}
```

**Properties**:
- `defaultValue`: `true` or `false`

**UI Control**: Checkbox

#### Number

For arbitrary numeric values without constraints.

```json
{
  "key": "fontSize",
  "name": "Font Size",
  "description": "Controls the font size in pixels",
  "type": "number",
  "defaultValue": 14
}
```

**Properties**:
- `defaultValue`: Any number (integer or float)

**UI Control**: Numeric input field

**Note**: For numbers with min/max constraints, use `range` type instead.

#### String

For text values.

```json
{
  "key": "fontFamily",
  "name": "Font Family",
  "description": "Controls the font family",
  "type": "string",
  "defaultValue": "Cascadia Code, Consolas, Monaco"
}
```

**Properties**:
- `defaultValue`: Any string

**UI Control**: Text input field

#### Enum

For a fixed set of predefined options.

```json
{
  "key": "colorTheme",
  "name": "Color Theme",
  "description": "Specifies the color theme used in the workbench",
  "type": "enum",
  "defaultValue": "dark",
  "options": ["dark", "light", "high-contrast"]
}
```

**Properties**:
- `defaultValue`: One of the values in `options`
- `options`: Array of string values

**UI Control**: Dropdown select

**Validation**: The value must be one of the options in the array.

#### Range

For numeric values with minimum and maximum bounds, displayed as a slider.

```json
{
  "key": "zoomLevel",
  "name": "Zoom Level",
  "description": "Adjust the zoom level of the workbench",
  "type": "range",
  "defaultValue": 100,
  "min": 50,
  "max": 200,
  "step": 10
}
```

**Properties**:
- `defaultValue`: Number between `min` and `max`
- `min`: Minimum allowed value (required)
- `max`: Maximum allowed value (required)
- `step`: Step increment (optional, defaults to 1)

**UI Control**: Slider with numeric display

**Validation**: 
- Value must be a number
- Value must be >= `min` and <= `max`
- If `step` is provided, value should align with step increments

## Full Path Keys

Settings are accessed using their full path, constructed from the hierarchy:

```
categoryKey.subCategoryKey.settingKey
```

### Examples

Given this schema:

```json
{
  "categories": {
    "workbench": {
      "key": "workbench",
      "categories": {
        "appearance": {
          "key": "appearance",
          "settings": {
            "language": {
              "key": "language",
              "type": "enum",
              "options": ["en", "fr"],
              "defaultValue": "en"
            }
          }
        }
      }
    }
  }
}
```

The full path would be: `workbench.appearance.language`

## Validation Rules

The SettingsService validates all values before saving:

1. **Type Validation**: Value must match the setting type
2. **Enum Validation**: Value must be in the options array
3. **Range Validation**: Value must be within min/max bounds
4. **Required Fields**: All required properties must be present in schema

## Complete Example

Here's a complete example showing all setting types:

```json
{
  "categories": {
    "workbench": {
      "key": "workbench",
      "name": "Workbench",
      "description": "Customize the appearance and behavior of the workbench",
      "categories": {
        "appearance": {
          "key": "appearance",
          "name": "Appearance",
          "description": "Customize the appearance of the workbench",
          "settings": {
            "language": {
              "key": "language",
              "name": "Language",
              "description": "Select the display language for the application",
              "type": "enum",
              "defaultValue": "en",
              "options": ["en", "fr"]
            },
            "colorTheme": {
              "key": "colorTheme",
              "name": "Color Theme",
              "description": "Specifies the color theme used in the workbench",
              "type": "enum",
              "defaultValue": "dark",
              "options": ["dark", "light", "high-contrast"]
            },
            "zoomLevel": {
              "key": "zoomLevel",
              "name": "Zoom Level",
              "description": "Adjust the zoom level of the workbench",
              "type": "range",
              "defaultValue": 100,
              "min": 50,
              "max": 200,
              "step": 10
            }
          }
        },
        "editor": {
          "key": "editor",
          "name": "Editor",
          "description": "Configure editor-related settings",
          "settings": {
            "fontSize": {
              "key": "fontSize",
              "name": "Font Size",
              "description": "Controls the font size in pixels",
              "type": "number",
              "defaultValue": 14
            },
            "lineNumbers": {
              "key": "lineNumbers",
              "name": "Line Numbers",
              "description": "Show line numbers in the editor",
              "type": "boolean",
              "defaultValue": true
            },
            "fontFamily": {
              "key": "fontFamily",
              "name": "Font Family",
              "description": "Controls the font family for the editor",
              "type": "string",
              "defaultValue": "Cascadia Code, Consolas, Monaco"
            }
          }
        }
      }
    },
    "test": {
      "key": "test",
      "name": "Test Settings",
      "description": "Test settings to demonstrate all available control types",
      "settings": {
        "testBoolean": {
          "key": "testBoolean",
          "name": "Test Boolean",
          "description": "A boolean setting example with a checkbox/toggle control",
          "type": "boolean",
          "defaultValue": false
        },
        "testNumber": {
          "key": "testNumber",
          "name": "Test Number",
          "description": "A number setting example with a numeric input control",
          "type": "number",
          "defaultValue": 42
        },
        "testString": {
          "key": "testString",
          "name": "Test String",
          "description": "A string setting example with a text input control",
          "type": "string",
          "defaultValue": "Hello World"
        },
        "testEnum": {
          "key": "testEnum",
          "name": "Test Enum",
          "description": "An enumeration setting example with a dropdown select control",
          "type": "enum",
          "defaultValue": "option2",
          "options": ["option1", "option2", "option3", "option4"]
        },
        "testRange": {
          "key": "testRange",
          "name": "Test Range",
          "description": "A range setting example with a slider control",
          "type": "range",
          "defaultValue": 50,
          "min": 0,
          "max": 100,
          "step": 5
        }
      }
    }
  }
}
```

## TypeScript Types

The schema corresponds to these TypeScript types:

```typescript
enum SettingType {
  BOOLEAN = 'boolean',
  NUMBER = 'number',
  STRING = 'string',
  ENUM = 'enum',
  RANGE = 'range'
}

interface BaseSettingDefinition {
  key: string
  name: string
  description: string
  defaultValue: unknown
}

interface BooleanSettingDefinition extends BaseSettingDefinition {
  type: SettingType.BOOLEAN
  defaultValue: boolean
}

interface NumberSettingDefinition extends BaseSettingDefinition {
  type: SettingType.NUMBER
  defaultValue: number
}

interface StringSettingDefinition extends BaseSettingDefinition {
  type: SettingType.STRING
  defaultValue: string
}

interface EnumSettingDefinition extends BaseSettingDefinition {
  type: SettingType.ENUM
  defaultValue: string
  options: string[]
}

interface RangeSettingDefinition extends BaseSettingDefinition {
  type: SettingType.RANGE
  defaultValue: number
  min: number
  max: number
  step?: number
}

type SettingDefinition =
  | BooleanSettingDefinition
  | NumberSettingDefinition
  | StringSettingDefinition
  | EnumSettingDefinition
  | RangeSettingDefinition

interface SettingCategory {
  key: string
  name: string
  description?: string
  categories?: Record<string, SettingCategory>
  settings?: Record<string, SettingDefinition>
}

interface SettingsSchema {
  categories: Record<string, SettingCategory>
}
```

## Best Practices

### 1. Consistent Keys

Use camelCase for all keys:
- Categories: `workbench`, `editor`, `terminal`
- Settings: `fontSize`, `lineNumbers`, `autoSave`

### 2. Descriptive Names

Use clear, concise names:
- Good: "Font Size", "Line Numbers", "Auto Save"
- Bad: "FS", "LN", "AS"

### 3. Detailed Descriptions

Descriptions should explain:
- What the setting controls
- When to use it
- Any side effects or dependencies
- Units (pixels, milliseconds, percentage, etc.)

### 4. Logical Hierarchy

Group related settings:
```
workbench/
  ├─ appearance/  (visual settings)
  ├─ editor/      (editor-specific)
  └─ behavior/    (functional settings)
```

### 5. Sensible Defaults

Choose defaults that:
- Work for most users
- Follow platform conventions
- Enable helpful features
- Use common values

### 6. Range Settings

For ranges:
- Use `step` to prevent invalid values
- Choose min/max that make sense for the use case
- Ensure defaultValue is within bounds
- Consider using round numbers for steps (5, 10, 25, etc.)

### 7. Enum Options

For enums:
- List all valid options
- Use descriptive option values
- Order options logically (most common first, or alphabetically)
- Keep option count reasonable (2-10 options ideal)

## Migration

If you need to change a setting:

### Renaming a Setting

1. Add the new setting with the new key
2. In SettingsService, add migration logic to copy old value to new key
3. Keep old setting for one version for backward compatibility
4. Remove old setting in next version

### Changing Setting Type

1. Create new setting with new type and different key
2. Add migration logic to convert old value to new format
3. Remove old setting after migration period

### Example Migration

```typescript
// In SettingsService constructor
private migrateSettings(): void {
  // Migrate old setting to new one
  const oldValue = this.storageService.get('old.setting.key')
  if (oldValue !== undefined) {
    this.storageService.set('new.setting.key', oldValue)
    this.storageService.delete('old.setting.key')
  }
}
```

## Localization

To support localized setting names and descriptions:

1. Use translation keys in your application code
2. Keep the schema in English as the canonical reference
3. Translate the UI strings in locale files
4. Consider adding a `translationKey` property to the schema for future i18n support

## Troubleshooting

### Schema Loading Errors

- Check JSON syntax (commas, quotes, brackets)
- Verify all required fields are present
- Ensure types match TypeScript definitions
- Check for duplicate keys

### Setting Not Appearing

- Verify the setting is in the correct category
- Check that the category hierarchy is valid
- Ensure all required properties are present
- Look for console errors on app start

### Validation Failures

- Verify defaultValue matches the type
- For enum, ensure defaultValue is in options
- For range, ensure defaultValue is between min and max
- Check that min < max for range settings

