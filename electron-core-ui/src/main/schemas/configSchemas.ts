/**
 * Zod schemas for validating configuration files and theme data.
 * Used by ThemeService, FeatureFlippingService, and StorageService
 * to fail fast with clear error messages on invalid input.
 */
import { z } from 'zod/v4'

// ==========================================================================
// Theme Schemas
// ==========================================================================

const yamlVariableEntrySchema = z.object({
  id: z.string(),
  value: z.string(),
  description: z.string().optional()
})

const yamlColorEntrySchema = z.object({
  id: z.string(),
  value: z.string(),
  description: z.string().optional()
})

export const yamlBaseFileSchema = z.object({
  variables: z.array(yamlVariableEntrySchema).optional()
})

export const yamlTypeBaseFileSchema = z.object({
  colors: z.array(yamlColorEntrySchema).optional()
})

export const yamlThemeFileSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  colors: z.record(z.string(), z.string()).optional()
})

const themeTypeSchema = z.enum(['dark', 'light', 'hc_dark', 'hc_light'])

const themeIndexEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: themeTypeSchema,
  description: z.string().optional(),
  file: z.string()
})

export const themeIndexSchema = z.object({
  themes: z.array(themeIndexEntrySchema)
})

// ==========================================================================
// Feature Flipping Schemas
// ==========================================================================

const basicStrategySchema = z.object({
  Type: z.literal('Basic'),
  Enabled: z.boolean()
})

const platformStrategySchema = z.object({
  Type: z.literal('Platform'),
  AvailableOn: z.array(z.enum(['desktop', 'web']))
})

const environmentStrategySchema = z.object({
  Type: z.literal('Environment'),
  AvailableIn: z.array(z.enum(['dev', 'prod']))
})

// Known built-in strategy type names. A strategy with one of these `Type`
// values MUST satisfy its strict built-in schema (invalid fields are
// rejected). Any other `Type` string is a custom strategy and passes through.
const BUILTIN_STRATEGY_TYPES = ['Basic', 'Platform', 'Environment'] as const

// Custom strategy fallback: any object with a string `Type` field that is
// NOT one of the built-in names (which would mean a malformed built-in).
// Placed last in the union so the strict built-in schemas are tried first.
const customStrategyFallbackSchema = z
  .object({ Type: z.string() })
  .catchall(z.unknown())
  .refine(
    (obj) => !(BUILTIN_STRATEGY_TYPES as readonly string[]).includes(obj.Type),
    { message: 'Built-in strategy type used with invalid fields' }
  )

// Use z.union (not z.discriminatedUnion) so the open-ended fallback
// arm can be appended without Zod rejecting non-literal Type values.
const featureStrategySchema = z.union([
  basicStrategySchema,
  platformStrategySchema,
  environmentStrategySchema,
  customStrategyFallbackSchema
])

const featureConfigSchema = z.object({
  Name: z.string(),
  Strategies: z.array(featureStrategySchema)
})

export const featuresYamlConfigSchema = z.object({
  Features: z.array(featureConfigSchema)
})

// ==========================================================================
// Storage Schema
// ==========================================================================

export const storageFileSchema = z.record(z.string(), z.unknown())

// ==========================================================================
// Settings Schemas
// ==========================================================================

const settingDefinitionSchema = z.object({
  id: z.string(),
  titleKey: z.string(),
  descriptionKey: z.string().optional(),
  type: z.string(),
  default: z.union([z.string(), z.number(), z.boolean()]),
  params: z.record(z.string(), z.unknown()).optional(),
  feature: z.string().optional(),
  featureDisabledDefault: z.union([z.string(), z.number(), z.boolean()]).optional(),
  userOnly: z.boolean().optional(),
  capability: z.string().optional()
})

// Recursive schema for group items (setting or nested group)
const settingsGroupItemSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.object({ setting: settingDefinitionSchema }),
    z.object({ group: settingsGroupSchema })
  ])
)

const settingsGroupSchema = z.object({
  id: z.string(),
  titleKey: z.string(),
  items: z.array(settingsGroupItemSchema)
})

export const settingsYamlConfigSchema = z.object({
  overrideDefaultGroups: z.boolean().optional(),
  groups: z.array(settingsGroupSchema)
})
