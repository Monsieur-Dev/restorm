#!/usr/bin/env node
/**
 * Brand icon generation script.
 *
 * Reads the source SVG from website/.brand/restorm.svg (located by walking up
 * from this package's root, or overridden with the BRAND_SVG env var) and
 * emits every raster variant the app needs:
 *
 *   assets/icons/icon.png        — 1024 px, Linux window / taskbar icon
 *   assets/icons/icon.ico        — multi-size ICO (16/24/32/48/64/128/256)
 *   assets/icons/icon.icns       — macOS ICNS (16…1024 iconset)
 *   assets/imgs/logo.png         — 1024 px full-res splash/onboarding
 *   assets/imgs/logo_400.png     — 400 px splash/onboarding (renderer)
 *
 * Usage (from the restorm/ package root):
 *   node scripts/generate-icons.mjs
 *   pnpm run generate-icons
 *
 * This script is also wired as a prebuild/predist/prepackage hook so icon
 * variants are always current when building for distribution.
 *
 * Pure-node dependencies (no system tools required):
 *   sharp      — SVG → PNG at any size (via libvips, bundled)
 *   png-to-ico — PNG buffers → multi-size Windows ICO
 *
 * ICNS is written by the built-in packIcns() helper using the documented
 * Apple ICNS binary format — no external tools needed.
 */

import { existsSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const sharp = require('sharp')
const { default: pngToIco } = require('png-to-ico')

// ── Paths ────────────────────────────────────────────────────────────────────

/** restorm/ package root */
const PKG_ROOT = resolve(__dirname, '..')

/**
 * Locate website/.brand/restorm.svg by walking up from PKG_ROOT.
 * Covers both the normal checkout (restorm-master/restorm/) and the
 * worktree layout (restorm-wt/task-xxx/restorm/) where the brand assets
 * live in restorm-master/website/.brand/.
 */
function findBrandSvg() {
  if (process.env.BRAND_SVG) return resolve(process.env.BRAND_SVG)

  // Walk up looking for website/.brand/restorm.svg
  let dir = PKG_ROOT
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, 'website/.brand/restorm.svg')
    if (existsSync(candidate)) return candidate
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }

  // Worktree sibling layout: restorm-wt/ sits next to restorm-master/
  const siblings = [
    resolve(PKG_ROOT, '../../..', 'restorm-master/website/.brand/restorm.svg'),
    resolve(PKG_ROOT, '../../../..', 'restorm-master/website/.brand/restorm.svg'),
  ]
  for (const s of siblings) {
    if (existsSync(s)) return s
  }

  return null
}

const SRC_SVG = findBrandSvg()
const ICONS_DIR = resolve(PKG_ROOT, 'assets/icons')
const IMGS_DIR = resolve(PKG_ROOT, 'assets/imgs')

// ── Preflight ────────────────────────────────────────────────────────────────

if (!SRC_SVG) {
  console.error('ERROR: brand SVG not found.')
  console.error('Searched for website/.brand/restorm.svg up to 6 directories above the package root.')
  console.error('Override with: BRAND_SVG=/path/to/restorm.svg node scripts/generate-icons.mjs')
  process.exit(1)
}

console.log(`Source SVG: ${SRC_SVG}`)

// ── SVG → PNG helper ──────────────────────────────────────────────────────────

/**
 * Render the source SVG to a PNG buffer at the given square pixel size.
 * sharp reads SVG via libvips (bundled — no system tool required).
 */
async function svgToPng(size) {
  return sharp(SRC_SVG)
    .resize(size, size, { fit: 'fill' })
    .png()
    .toBuffer()
}

// ── ICNS writer ───────────────────────────────────────────────────────────────

/**
 * Write a macOS ICNS file from a map of size → PNG Buffer.
 *
 * ICNS binary layout (big-endian):
 *   4 bytes  magic  'icns'
 *   4 bytes  total file size
 *   for each icon:
 *     4 bytes  OSType tag
 *     4 bytes  data length including the 8-byte header
 *     N bytes  PNG data
 *
 * Using 'icp4'…'ic10' (PNG-native entries, supported since macOS 10.7).
 */
function packIcns(pngMap) {
  const entries = [
    { tag: 'icp4', size: 16 },
    { tag: 'icp5', size: 32 },
    { tag: 'icp6', size: 64 },
    { tag: 'ic07', size: 128 },
    { tag: 'ic08', size: 256 },
    { tag: 'ic09', size: 512 },
    { tag: 'ic10', size: 1024 },
  ]

  const chunks = []
  for (const { tag, size } of entries) {
    const png = pngMap[size]
    if (!png) continue
    const header = Buffer.allocUnsafe(8)
    header.write(tag, 0, 'ascii')
    header.writeUInt32BE(png.length + 8, 4)
    chunks.push(header, png)
  }

  const body = Buffer.concat(chunks)
  const file = Buffer.allocUnsafe(8 + body.length)
  file.write('icns', 0, 'ascii')
  file.writeUInt32BE(file.length, 4)
  body.copy(file, 8)
  return file
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Rendering PNG size variants ===')

  const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 400, 512, 1024]
  const pngMap = {}

  for (const size of PNG_SIZES) {
    process.stdout.write(`  ${size}×${size}… `)
    pngMap[size] = await svgToPng(size)
    console.log(`${pngMap[size].length} bytes`)
  }

  // ── assets/icons/icon.png (1024 px) ────────────────────────────────────────
  console.log('\n=== Writing assets/icons/icon.png (1024 px) ===')
  writeFileSync(resolve(ICONS_DIR, 'icon.png'), pngMap[1024])

  // ── assets/imgs/logo.png (1024 px) ─────────────────────────────────────────
  console.log('=== Writing assets/imgs/logo.png (1024 px) ===')
  writeFileSync(resolve(IMGS_DIR, 'logo.png'), pngMap[1024])

  // ── assets/imgs/logo_400.png (400 px) ──────────────────────────────────────
  console.log('=== Writing assets/imgs/logo_400.png (400 px) ===')
  writeFileSync(resolve(IMGS_DIR, 'logo_400.png'), pngMap[400])

  // ── assets/icons/icon.ico (multi-size ICO) ─────────────────────────────────
  console.log('=== Writing assets/icons/icon.ico (multi-size ICO) ===')
  const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
  const icoBuf = await pngToIco(ICO_SIZES.map(s => pngMap[s]))
  writeFileSync(resolve(ICONS_DIR, 'icon.ico'), icoBuf)

  // ── assets/icons/icon.icns (macOS) ─────────────────────────────────────────
  console.log('=== Writing assets/icons/icon.icns (macOS) ===')
  const icnsBuf = packIcns(pngMap)
  writeFileSync(resolve(ICONS_DIR, 'icon.icns'), icnsBuf)

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n=== Done ===')
  console.log('Generated:')
  console.log(`  assets/icons/icon.png        (${pngMap[1024].length} bytes — 1024 px Linux window/dock)`)
  console.log(`  assets/icons/icon.ico        (${icoBuf.length} bytes — multi-size Windows ICO)`)
  console.log(`  assets/icons/icon.icns       (${icnsBuf.length} bytes — macOS iconset)`)
  console.log(`  assets/imgs/logo.png         (${pngMap[1024].length} bytes — 1024 px splash/onboarding)`)
  console.log(`  assets/imgs/logo_400.png     (${pngMap[400].length} bytes — 400 px splash/onboarding)`)
  console.log()
  console.log('Re-run this script whenever website/.brand/restorm.svg is updated.')
}

main().catch(err => {
  console.error('generate-icons failed:', err)
  process.exit(1)
})
