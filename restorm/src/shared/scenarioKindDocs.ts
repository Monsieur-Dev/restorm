import type { ScenarioNodeKind, KindSpec, ScenarioKindDoc } from './scenarioKindRegistry'
import { SCENARIO_KIND_REGISTRY } from './scenarioKindRegistry'

// ScenarioKindDoc moved to the kind registry (the single source of truth);
// re-exported here so existing importers keep working.
export type { ScenarioKindDoc } from './scenarioKindRegistry'

/**
 * Documentation for every typed-value shape a node `config` (or an input's
 * `valueType`) can carry — the `{ type, … }` objects that flow through ports.
 * A scenario `config` accepts a free-form bag, so these are not schema-enforced;
 * this is the reference an MCP client needs to author them without reading
 * source. Surfaced by `describe_scenario_kinds` alongside the kind catalogue.
 *
 * Keyed by the literal `type` discriminator (the union in `valuePersistence.ts`).
 */
export const VALUE_TYPE_DOCS: Record<string, { shape: string; summary: string }> = {
  string: { shape: '{ type: "string", value: "<text>" }', summary: 'A plain text value.' },
  numeric: { shape: '{ type: "numeric", value: 42, format: "decimal" }', summary: 'A number. `format` is a display hint (e.g. decimal).' },
  boolean: { shape: '{ type: "boolean", value: true }', summary: 'A boolean.' },
  datetime: { shape: '{ type: "datetime", value: "<ISO-8601>", format: "<fmt>" }', summary: 'A date/time (ISO string).' },
  color: { shape: '{ type: "color", value: "#rrggbb" }', summary: 'A colour (hex string).' },
  expression: { shape: '{ type: "expression", value: "{{handlebars}}" }', summary: 'A Handlebars template rendered at runtime against inputs + run variables.' },
  secret: { shape: '{ type: "secret", source: "<sourceId>", params: { … } }', summary: 'A reference to a value resolved from an external source (env var, sibling env file, …). The plaintext is resolved in the main process at run time and never persisted or returned to a client. Call `list_value_sources` for the available `source` ids and their `params`.' },
  null: { shape: '{ type: "null" }', summary: 'The null value. Equal only to another null (no coercion).' },
  list: { shape: '{ type: "list", items: [ <PersistedValue>, … ] }', summary: 'An agnostic, untyped list — an array of any typed values (lists can nest).' },
  enum: { shape: '{ type: "enum", value: "<option>", enumDefinitionId: "<id>" }', summary: 'A single pick from an enum definition.' },
  enumList: { shape: '{ type: "enumList", value: ["a","b"], enumDefinitionId: "<id>" }', summary: 'A multi-pick from an enum → resolves to a real array.' },
  customList: { shape: '{ type: "customList", listId: "<id>", label: "<picked>" }', summary: 'A single pick from a user-defined value list.' },
  customListMulti: { shape: '{ type: "customListMulti", listId: "<id>", labels: ["a","b"] }', summary: 'A multi-pick from a user-defined value list → resolves to a real array.' },
  variable: { shape: '{ type: "variable", value: "<name>" }', summary: 'A reference to a run variable (declared by an input/setVariable); read live at runtime.' },
  environment: { shape: '{ type: "environment", value: "<environmentId>" }', summary: 'The selected environment; an empty / unresolvable id resolves to null.' }
}

/**
 * Per-kind documentation (summary + config keys) — the data behind the
 * `describe_scenario_kinds` MCP tool — DERIVED from the kind registry's `doc`
 * field (the single source of truth), so a kind is documented in exactly one
 * place. Ports come from {@link defaultPortsForKind}; this adds the *semantics*
 * a port list can't convey: what the box does and which `config` keys it reads.
 */
export const SCENARIO_KIND_DOCS: Record<ScenarioNodeKind, ScenarioKindDoc> = Object.fromEntries(
  (Object.entries(SCENARIO_KIND_REGISTRY) as [ScenarioNodeKind, KindSpec][]).map(([kind, spec]) => [kind, spec.doc])
) as Record<ScenarioNodeKind, ScenarioKindDoc>
