#!/usr/bin/env node
/**
 * Recompute the sha512/size in a `latest*.yml` update feed from the files on
 * disk. Stapling a notarization ticket into a .dmg/.zip CHANGES the file, so a
 * feed electron-builder generated before stapling no longer matches — and
 * electron-updater rejects a hash mismatch. Run this after `xcrun stapler
 * staple` (async-notarization flow) so the feed describes the stapled artifacts.
 *
 * No YAML dependency: a `latest*.yml` is a flat, machine-generated file, so a
 * line-oriented rewrite is safe and avoids pulling js-yaml into the runner.
 * Each `- url:` (a files[] entry) and the top-level `path:` name a file; the
 * `sha512:`/`size:` lines that follow are rewritten from that file on disk.
 *
 * Usage: node scripts/restaple-feed.mjs <dist-dir> <latest*.yml> [<latest*.yml> ...]
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import crypto from 'node:crypto'
import { basename, join } from 'node:path'

const [dist, ...ymls] = process.argv.slice(2)
if (!dist || ymls.length === 0) {
  console.error('usage: restaple-feed.mjs <dist-dir> <latest*.yml> [...]')
  process.exit(2)
}

const sha512b64 = (f) =>
  crypto.createHash('sha512').update(readFileSync(f)).digest('base64')

for (const yml of ymls) {
  const lines = readFileSync(yml, 'utf8').split('\n')
  // The file the subsequent sha512:/size: lines describe: the most recent
  // `- url:` (a files[] entry) or top-level `path:`.
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const url = lines[i].match(/^\s*-\s+url:\s*(.+?)\s*$/)
    if (url) {
      current = basename(url[1])
      continue
    }
    const path = lines[i].match(/^path:\s*(.+?)\s*$/)
    if (path) {
      current = basename(path[1])
      continue
    }
    if (!current) continue
    const sha = lines[i].match(/^(\s*)sha512:\s*/)
    if (sha) {
      lines[i] = `${sha[1]}sha512: ${sha512b64(join(dist, current))}`
      continue
    }
    const size = lines[i].match(/^(\s*)size:\s*/)
    if (size) {
      lines[i] = `${size[1]}size: ${statSync(join(dist, current)).size}`
    }
  }
  writeFileSync(yml, lines.join('\n'))
  console.log(`regenerated ${yml} from stapled artifacts in ${dist}`)
}
