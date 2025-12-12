import Handlebars from 'handlebars'
import type { KeyValue, Environment } from '../types/collections'

export type VariableContext = Record<string, string>

/** Type of source where a variable was defined */
export type VariableSourceType = 'environment' | 'folder' | 'request'

/** Information about where a variable was defined */
export interface VariableSource {
  /** Type of the source (environment, folder, or request) */
  type: VariableSourceType
  /** ID of the source entity */
  id: string
  /** Human-readable path to the source (e.g., ["Swagger Petstore", "Default"]) */
  path: string[]
}

/** A resolved variable with its value and source information */
export interface ResolvedVariable {
  /** The resolved value of the variable */
  value: string
  /** Where this variable was defined */
  source: VariableSource
}

/** Map of variable names to their resolved values and sources */
export type VariableContextWithSources = Record<string, ResolvedVariable>

export interface ResolvedKeyValue {
  key: string
  value: string
  description?: string | undefined
}

export interface ResolvedSequence {
  /** Context available before each row (same length as rows) */
  contextsBeforeRow: VariableContext[]
  /** Rows after Handlebars resolution */
  resolvedRows: ResolvedKeyValue[]
  /** Final context after processing all rows */
  finalContext: VariableContext
}

function compileTemplate(template: string): HandlebarsTemplateDelegate {
  // Precompile with no escaping (we want raw strings)
  return Handlebars.compile(template, { noEscape: true })
}

/**
 * Evaluate a sequence of KeyValue rows using Handlebars.
 * Each row sees the context built from baseContext plus all previous resolved rows.
 */
export function resolveKeyValueSequence(rows: KeyValue[], baseContext: VariableContext): ResolvedSequence {
  let currentContext: VariableContext = { ...baseContext }
  const contextsBeforeRow: VariableContext[] = []
  const resolvedRows: ResolvedKeyValue[] = []

  for (const row of rows) {
    const contextSnapshot = { ...currentContext }
    contextsBeforeRow.push(contextSnapshot)

    let resolvedKey: string
    let resolvedValue: string

    try {
      const compileKey = compileTemplate(row.key)
      resolvedKey = compileKey(contextSnapshot)
    } catch {
      // Return original key if Handlebars parsing fails
      resolvedKey = row.key
    }

    try {
      const compileValue = compileTemplate(row.value)
      resolvedValue = compileValue(contextSnapshot)
    } catch {
      // Return original value if Handlebars parsing fails
      resolvedValue = row.value
    }

    if (resolvedKey) {
      currentContext = {
        ...currentContext,
        [resolvedKey]: resolvedValue
      }
    }

    resolvedRows.push({
      key: resolvedKey,
      value: resolvedValue,
      description: row.description
    })
  }

  return {
    contextsBeforeRow,
    resolvedRows,
    finalContext: currentContext
  }
}

/**
 * Build a VariableContext from a list of KeyValue pairs
 */
export function keyValuesToContext(values: KeyValue[]): VariableContext {
  const context: VariableContext = {}
  for (const kv of values) {
    context[kv.key] = kv.value
  }
  return context
}

/**
 * Evaluate a single template string with the given context.
 * Returns the original template if parsing fails (e.g., invalid Handlebars syntax).
 */
export function resolveTemplate(template: string, context: VariableContext): string {
  try {
    const compile = compileTemplate(template)
    return compile(context)
  } catch {
    // Return original template if Handlebars parsing fails
    return template
  }
}

/**
 * Find the chain of environments from root to the target environment id.
 */
export function findEnvironmentChain(
  environments: Environment[],
  targetId: string
): Environment[] | null {
  const stack: Environment[] = []

  const dfs = (envs: Environment[]): boolean => {
    for (const env of envs) {
      stack.push(env)
      if (env.id === targetId) {
        return true
      }
      if (env.subEnvironments && dfs(env.subEnvironments)) {
        return true
      }
      stack.pop()
    }
    return false
  }

  const found = dfs(environments)
  if (!found) return null
  return [...stack]
}

/**
 * Resolve variables for a selected environment, including all parent environments in the chain.
 */
export function resolveEnvironmentVariables(
  environments: Environment[] | undefined,
  selectedEnvId: string | null
): VariableContext {
  if (!environments || !selectedEnvId) {
    return {}
  }

  const chain = findEnvironmentChain(environments, selectedEnvId)
  if (chain) {
    let context: VariableContext = {}
    for (const env of chain) {
      const sequence = resolveKeyValueSequence(env.variables ?? [], context)
      context = sequence.finalContext
    }
    return context
  }

  return {}
}

/**
 * Resolve variables for a selected environment with source tracking.
 * Returns both values and information about where each variable was defined.
 */
export function resolveEnvironmentVariablesWithSources(
  environments: Environment[] | undefined,
  selectedEnvId: string | null,
  folderPath: string[] = []
): VariableContextWithSources {
  if (!environments || !selectedEnvId) {
    return {}
  }

  const chain = findEnvironmentChain(environments, selectedEnvId)
  if (!chain) {
    return {}
  }

  const result: VariableContextWithSources = {}
  let context: VariableContext = {}

  for (const env of chain) {
    const envPath = [...folderPath, env.name]
    const sequence = resolveKeyValueSequence(env.variables ?? [], context)

    // Track source for each new variable defined in this environment
    for (const resolved of sequence.resolvedRows) {
      if (resolved.key) {
        result[resolved.key] = {
          value: resolved.value,
          source: {
            type: 'environment',
            id: env.id,
            path: envPath
          }
        }
      }
    }

    context = sequence.finalContext
  }

  return result
}

/**
 * Convert VariableContextWithSources to simple VariableContext (values only)
 */
export function stripSources(contextWithSources: VariableContextWithSources): VariableContext {
  const result: VariableContext = {}
  for (const [key, resolved] of Object.entries(contextWithSources)) {
    result[key] = resolved.value
  }
  return result
}

