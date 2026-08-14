#!/usr/bin/env node
/**
 * Restorm launcher.
 *
 * `restorm …` runs Restorm and passes every argument through, so
 * `restorm --open api.restorm --run "Smoke tests" --headless` behaves exactly as
 * it does on a desktop install. The application itself is not in this package —
 * it is resolved, in order:
 *
 *   1. a system installation, if the machine has one (a user who installed the
 *      .deb, the .dmg or the Windows installer expects THAT build to run);
 *   2. the per-user cache, from a previous run;
 *   3. a fresh download of the official build, verified against the checksum
 *      published in the release manifest, then cached.
 *
 * Step 3 happens once per version. A CI job that runs this twice downloads
 * once. Zero dependencies.
 */
'use strict'

const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const { ensureBuild } = require('../lib/install')

const CANDIDATES = {
  linux: ['/opt/Restorm/restorm-bin', '/snap/bin/restorm', '/usr/bin/restorm'],
  darwin: ['/Applications/Restorm.app/Contents/MacOS/Restorm'],
  win32: [
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Restorm', 'Restorm.exe'),
    join(process.env.ProgramFiles || 'C:\\Program Files', 'Restorm', 'Restorm.exe')
  ]
}

function findInstalled() {
  for (const p of CANDIDATES[process.platform] || []) {
    if (p && existsSync(p)) return p
  }
  return null
}

function run(exe, args) {
  const r = spawnSync(exe, args, { stdio: 'inherit' })
  if (r.error) throw r.error
  process.exit(r.status ?? 0)
}

function progress(done, total) {
  if (!process.stdout.isTTY) return
  const mib = (n) => (n / 1048576).toFixed(1)
  process.stdout.write(total ? `\r  ${mib(done)} / ${mib(total)} MiB` : `\r  ${mib(done)} MiB`)
}

async function main() {
  const args = process.argv.slice(2)

  const installed = findInstalled()
  if (installed) run(installed, args)

  const { exe, version, cached } = await ensureBuild({
    log: (m) => console.error(m),
    onProgress: progress
  })
  if (!cached && process.stdout.isTTY) process.stdout.write('\n')
  if (!cached) console.error(`Restorm ${version} is ready.`)

  run(exe, args)
}

main().catch((e) => {
  console.error(e.message || e)
  console.error('Manual downloads: https://restorm.app/download')
  process.exit(1)
})
