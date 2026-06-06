import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import type { NodeExecutor } from '../types'
import { resolveOperand } from '../conditionEval'
import { resolveWorkspacePath } from '../scenarioFilePath'
import { validateAgainstSchema } from '../../../shared/schemaValidate'

/** `schema`: validate the resolved `value` against the configured JSON Schema
 * (ajv). Emits the value on `valid` or `invalid` + the error list on `errors`.
 * A malformed schema / no schema THROWS → the implicit `error` port. */
export const schemaExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { schema?: unknown; value?: unknown }
  const value = resolveOperand(act.inputs['value'], cfg.value, ctx.variables)
  // The JSON Schema may be wired (a string input) or set inline in config.
  const wiredSchema = act.inputs['schema']
  const schemaText = typeof wiredSchema === 'string' ? wiredSchema : typeof cfg.schema === 'string' ? cfg.schema : ''
  if (schemaText.trim() === '') throw new Error('schema: no JSON Schema provided')
  const { valid, errors } = validateAgainstSchema(value, schemaText)
  return { outputs: [{ port: valid ? 'valid' : 'invalid', value }, { port: 'errors', value: errors }] }
}

/** `readFile`: read the file at the resolved `path` (absolute, or relative to
 * the open `.restorm` dir) → its text on `content`. A missing path / read error
 * THROWS → the implicit `error` port. */
export const readFileExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { path?: unknown }
  const raw = resolveOperand(act.inputs['path'], cfg.path, ctx.variables)
  const p = typeof raw === 'string' ? raw : ''
  if (p.trim() === '') throw new Error('readFile: no path provided')
  const content = readFileSync(resolveWorkspacePath(p, ctx.workspaceDir), 'utf-8')
  return { outputs: [{ port: 'content', value: content }] }
}

/** `writeFile`: write (replace) or append the resolved `content` to the file at
 * the resolved `path`. A missing path THROWS → the implicit `error` port. */
export const writeFileExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { path?: unknown; mode?: unknown; content?: unknown }
  const raw = resolveOperand(act.inputs['path'], cfg.path, ctx.variables)
  const p = typeof raw === 'string' ? raw : ''
  if (p.trim() === '') throw new Error('writeFile: no path provided')
  const target = resolveWorkspacePath(p, ctx.workspaceDir)
  const content = resolveOperand(act.inputs['content'], cfg.content, ctx.variables)
  const text = typeof content === 'string' ? content : content === undefined || content === null ? '' : JSON.stringify(content, null, 2)
  if (cfg.mode === 'append') appendFileSync(target, text, 'utf-8')
  else writeFileSync(target, text, 'utf-8')
  return { outputs: [] }
}
