import Handlebars from 'handlebars'
import type { KeyValue, Environment } from '../types/collections'

export type VariableContext = Record<string, string>

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

    const compileKey = compileTemplate(row.key)
    const compileValue = compileTemplate(row.value)

    const resolvedKey = compileKey(contextSnapshot)
    const resolvedValue = compileValue(contextSnapshot)

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
 */
export function resolveTemplate(template: string, context: VariableContext): string {
  const compile = compileTemplate(template)
  return compile(context)
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

