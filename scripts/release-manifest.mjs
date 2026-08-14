#!/usr/bin/env node
/**
 * Writes the release manifest the npm launcher reads.
 *
 * The launcher must know three things before it downloads 400 MB: which file
 * this machine needs, where it lives, and what it should hash to. The
 * `latest*.yml` update feeds electron-builder already publishes answer the
 * first two for electron-updater, but they describe installers, carry sha512
 * of the installer rather than of a runnable build, and their shape is
 * electron-updater's to change. This manifest is ours.
 *
 * ONE FILE PER PLATFORM, deliberately: the release workflow publishes to R2
 * from inside its build matrix, so no job ever holds all three platforms'
 * artifacts at once. A merged manifest would need a fourth job whose only
 * purpose is to agree with the other three.
 *
 * Artifact URLs point into the immutable `v<version>/` folder rather than the
 * overwritten `latest/` one: a manifest and the build it checksums must never
 * be able to disagree, which is exactly what a mutable URL invites.
 *
 * Usage:
 *   node scripts/release-manifest.mjs <dist-dir> <version> <base-url> [out-dir]
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** file name → what the launcher needs to know about it. */
function classify(name) {
  if (name.endsWith('.AppImage')) {
    return { platform: 'linux', key: 'linux-x64', kind: 'appimage', exec: 'Restorm.AppImage' }
  }
  if (name.endsWith('.zip')) {
    const exec = 'Restorm.app/Contents/MacOS/Restorm'
    if (name.endsWith('-arm64-mac.zip')) return { platform: 'darwin', key: 'darwin-arm64', kind: 'zip', exec }
    if (name.endsWith('-mac.zip')) return { platform: 'darwin', key: 'darwin-x64', kind: 'zip', exec }
    // Every zip the Windows job produces is the portable build; macOS zips are
    // the only other ones and they are already matched above.
    return { platform: 'win32', key: 'win32-x64', kind: 'zip', exec: 'Restorm.exe' }
  }
  return null
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function main() {
  const [dist, version, base, outDir = dist] = process.argv.slice(2)
  if (!dist || !version || !base) {
    console.error('usage: release-manifest.mjs <dist-dir> <version> <base-url> [out-dir]')
    process.exit(2)
  }
  const root = base.replace(/\/+$/, '')

  const byPlatform = new Map()
  for (const name of await readdir(dist)) {
    const path = join(dist, name)
    if (!(await stat(path)).isFile()) continue
    const spec = classify(name)
    if (!spec) continue
    const manifest = byPlatform.get(spec.platform) || { version, artifacts: {} }
    manifest.artifacts[spec.key] = {
      kind: spec.kind,
      file: basename(name),
      url: `${root}/v${version}/${name}`,
      sha256: await sha256(path),
      size: (await stat(path)).size,
      exec: spec.exec
    }
    byPlatform.set(spec.platform, manifest)
  }

  if (byPlatform.size === 0) {
    console.error(`no launchable artifact found in ${dist} — nothing to describe`)
    process.exit(1)
  }

  for (const [platform, manifest] of byPlatform) {
    const out = join(outDir, `manifest-${platform}.json`)
    await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`${out}: ${Object.keys(manifest.artifacts).join(', ')}`)
  }
}

await main()
