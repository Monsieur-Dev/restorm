#!/usr/bin/env node
/**
 * Convenience runner for the headless CLI scenario engine against the committed
 * reference project. Copies the fixture (+ its responses zip + readFile sidecar)
 * into a throwaway temp dir so a run never churns the committed samples, then
 * spawns the BUILT app with `--run`.
 *
 * Usage:
 *   node scripts/headless-run.mjs ["<scenario name/path>"] [extra --flags…]
 * Defaults to the Main orchestrator with the SecondInput datetime supplied.
 *
 * Requires a prior build (`pnpm build`) — points at `dist/main/index.js`.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, copyFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'

const MAIN_JS = 'dist/main/index.js'
if (!existsSync(MAIN_JS)) {
  console.error(`${MAIN_JS} not found — run \`pnpm build\` first.`)
  process.exit(1)
}

const SAMPLES = 'tests/e2e/samples'
const REF = 'scenarios-e2e-reference-tests'
const passthrough = process.argv.slice(2)
const scenario = passthrough[0] && !passthrough[0].startsWith('-') ? passthrough.shift() : 'Auth Service/Pet API/Main'

const dir = mkdtempSync(join(tmpdir(), 'restorm-headless-'))
const project = join(dir, `${REF}.restorm`)
copyFileSync(join(SAMPLES, `${REF}.restorm`), project)
copyFileSync(join(SAMPLES, `${REF}.restorm.responses.zip`), `${project}.responses.zip`)
copyFileSync(join(SAMPLES, `${REF}.pet-sample.json`), join(dir, `${REF}.pet-sample.json`))

const defaultParams = scenario.endsWith('Main') ? ['--param', 'SecondInput=2030-01-15T08:30:00.000Z'] : []
const args = [
  '--no-sandbox', '--ozone-platform=x11', MAIN_JS,
  '--open', project, '--run', scenario, '--headless', '--all-logs',
  ...defaultParams, ...passthrough
]

const child = spawn(electronPath, args, { stdio: 'inherit', env: { ...process.env, TZ: 'UTC' } })
child.on('exit', (code) => { process.exit(code ?? 1) })
