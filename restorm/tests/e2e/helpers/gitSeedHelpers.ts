import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import { gitEnv } from '../../integration/gitServerSeed'

/**
 * Restorm-specific git-suite e2e helpers — reading/mutating the seeded
 * single-file `.restorm` project's raw YAML, and driving host-side git
 * as "another actor" (a collaborator, or the local session's own prior
 * work before restorm ever opens the file). Shared by every git BDD
 * suite (git-conflict, git-mcp, ...) that needs to construct real
 * divergent history without going through the app's own UI/MCP surface
 * for the SIDE it's simulating.
 */

export interface SeedEntity { id: string, items?: SeedEntity[], [key: string]: unknown }
export interface SeedDocument { collections: SeedEntity[] }

export function readSeedDocument(dir: string): SeedDocument {
  return yamlParse(readFileSync(join(dir, 'api.restorm'), 'utf-8')) as SeedDocument
}

export function writeSeedDocument(dir: string, doc: SeedDocument): void {
  writeFileSync(join(dir, 'api.restorm'), yamlStringify(doc), 'utf-8')
}

/** A request/folder/scenario can live nested inside another folder's
 * `items` (a request is a tree child, not necessarily a sibling top-level
 * collection) — search recursively rather than assuming every entity
 * sits at the top level of `collections`. */
export function findEntity(items: SeedEntity[], entityId: string): SeedEntity | undefined {
  for (const item of items) {
    if (item.id === entityId) return item
    if (item.items) {
      const found = findEntity(item.items, entityId)
      if (found) return found
    }
  }
  return undefined
}

/** Raw (non-UI, non-MCP) edit of one field on one seeded entity — used to
 * construct the "other side" of a conflict (a collaborator's clone, or a
 * scenario's own local clone before restorm/an MCP session ever opens it)
 * without going through the app. */
export function setEntityField(dir: string, entityId: string, field: string, value: unknown): void {
  const doc = readSeedDocument(dir)
  const entity = findEntity(doc.collections, entityId)
  if (!entity) throw new Error(`seed entity "${entityId}" not found in ${dir}/api.restorm`)
  entity[field] = value
  writeSeedDocument(dir, doc)
}

export function gitCommit(dir: string, author: { email: string, name: string }, message: string): void {
  execSync('git add api.restorm', { cwd: dir, stdio: 'ignore', env: gitEnv() })
  execSync(`git -c user.email=${author.email} -c user.name="${author.name}" commit -m "${message}"`, { cwd: dir, stdio: 'ignore', env: gitEnv() })
}

export function gitPush(dir: string): void {
  execSync('git push origin main', { cwd: dir, stdio: 'ignore', env: gitEnv() })
}
