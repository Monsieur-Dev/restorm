/**
 * The `code`-node runtime registry: a language → {@link CodeRuntime} lookup.
 * Runtimes self-register (see `./index`); the executor resolves one by the
 * node's `config.language` and never knows the concrete engines.
 */
import type { CodeRuntime } from './types'

const RUNTIMES: CodeRuntime[] = []

/** Register a runtime. Later registrations win for a shared language (so a host
 * can override a default), but in practice each language has exactly one. */
export function registerCodeRuntime(runtime: CodeRuntime): void {
  RUNTIMES.unshift(runtime)
}

/** The runtime serving `language`, or undefined when no runtime is wired for it
 * (the executor then throws a clear "unsupported language" error). */
export function getCodeRuntime(language: string): CodeRuntime | undefined {
  return RUNTIMES.find((rt) => rt.languages.includes(language))
}

/** Every language with a wired runtime (for diagnostics / docs). */
export function registeredCodeLanguages(): string[] {
  return [...new Set(RUNTIMES.flatMap((rt) => [...rt.languages]))]
}
