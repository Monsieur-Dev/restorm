#!/usr/bin/env node
/**
 * Restorm installer bootstrap.
 *
 * If Restorm is already installed, exec it (all arguments pass through, so
 * `restorm --run scenario.restorm` works). Otherwise, detect the platform,
 * download the right build from the official release bucket, and guide the
 * install. Zero dependencies.
 */
'use strict'

const { spawnSync, execFileSync } = require('node:child_process')
const { createWriteStream, existsSync, mkdirSync, chmodSync } = require('node:fs')
const { join } = require('node:path')
const { homedir, tmpdir } = require('node:os')

const BASE = 'https://dl.restorm.app/latest'

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

function artifact() {
  const { platform, arch } = process
  if (platform === 'linux') return { url: `${BASE}/Restorm.AppImage`, file: 'Restorm.AppImage', run: true }
  if (platform === 'darwin') {
    return arch === 'arm64'
      ? { url: `${BASE}/Restorm-arm64.dmg`, file: 'Restorm-arm64.dmg' }
      : { url: `${BASE}/Restorm.dmg`, file: 'Restorm.dmg' }
  }
  if (platform === 'win32') return { url: `${BASE}/Restorm-Setup.exe`, file: 'Restorm-Setup.exe' }
  return null
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${url}`)
  const total = Number(res.headers.get('content-length') || 0)
  let done = 0
  const out = createWriteStream(dest)
  const reader = res.body.getReader()
  for (;;) {
    const { value, done: end } = await reader.read()
    if (end) break
    out.write(Buffer.from(value))
    done += value.length
    if (total && process.stdout.isTTY) {
      process.stdout.write(`\r  ${(done / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MiB`)
    }
  }
  await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())))
  if (process.stdout.isTTY) process.stdout.write('\n')
}

async function main() {
  const installed = findInstalled()
  if (installed) {
    const r = spawnSync(installed, process.argv.slice(2), { stdio: 'inherit' })
    process.exit(r.status ?? 0)
  }

  const a = artifact()
  if (!a) {
    console.error(`Unsupported platform: ${process.platform}/${process.arch}`)
    console.error('Downloads for every platform: https://restorm.app/download')
    process.exit(1)
  }

  console.log('Restorm is not installed yet — fetching the latest build…')
  const dir = join(homedir(), 'Downloads')
  const dest = join(existsSync(dir) ? dir : tmpdir(), a.file)
  await download(a.url, dest)
  console.log(`Saved to ${dest}`)

  if (a.run && process.platform === 'linux') {
    chmodSync(dest, 0o755)
    console.log('Launching the AppImage… (prefer a package? https://restorm.app/download)')
    const r = spawnSync(dest, process.argv.slice(2), { stdio: 'inherit' })
    process.exit(r.status ?? 0)
  }
  if (process.platform === 'darwin') {
    console.log('Opening the disk image — drag Restorm to Applications, then run `restorm` again.')
    try { execFileSync('open', [dest]) } catch {}
  } else if (process.platform === 'win32') {
    console.log('Launching the installer — run `restorm` again once it finishes.')
    try { execFileSync('cmd', ['/c', 'start', '', dest]) } catch {}
  }
}

main().catch((e) => {
  console.error(e.message || e)
  console.error('Manual downloads: https://restorm.app/download')
  process.exit(1)
})
