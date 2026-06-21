#!/usr/bin/env node
/**
 * Generate the restorm brand icon font (woff2) from the glyph source SVGs.
 *
 * Prerequisites:
 *   - Run from the `restorm/` package root (or via `pnpm generate:brand-font`)
 *   - `fantasticon` is a pinned devDependency — no global install needed
 *
 * Inputs  (committed, re-extract from website/.brand/restorm.svg when the logo changes):
 *   src/renderer/assets/fonts/src/restorm-logo-contour.svg     — R + bolt + frame contour
 *   src/renderer/assets/fonts/src/restorm-logo-no-contour.svg  — R + bolt, no frame
 *
 * Outputs (committed generated artifacts):
 *   src/renderer/assets/fonts/restorm-brand.woff2  — the icon font
 *   src/renderer/assets/fonts/restorm-brand.css    — @font-face + utility classes
 *
 * Glyph codepoints (Private Use Area — never mapped to a real character):
 *   U+F101  restorm-brand-restorm-logo-no-contour  (.restorm-brand-no-contour)
 *   U+F102  restorm-brand-restorm-logo-contour     (.restorm-brand-contour)
 *
 * Re-run after updating the source SVGs:
 *   pnpm generate:brand-font
 *
 * To update the source SVGs after a logo change:
 *   1. Open website/.brand/restorm.svg in Inkscape.
 *   2. Extract the R path (from clipPath) and bolt path; update the src/ SVGs.
 *   3. Re-run this script.
 */

import { generateFonts } from 'fantasticon'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const inputDir = resolve(root, 'src/renderer/assets/fonts/src')
const outputDir = resolve(root, 'src/renderer/assets/fonts')

console.log('Generating restorm brand icon font...')
console.log(`  Input:  ${inputDir}`)
console.log(`  Output: ${outputDir}`)

await generateFonts({
  name: 'restorm-brand',
  inputDir,
  outputDir,
  fontTypes: ['woff2'],
  assetTypes: ['css', 'json'],
  prefix: 'restorm-brand',
  tag: 'i',
  fontHeight: 1000,
  // normalize: false preserves the original SVG viewBox proportions — with true,
  // fantasticon crops each glyph to its bounding box and rescales to fill the em-box,
  // which distorts the R-top / bolt proportion vs the source brand SVG.
  normalize: false,
  // Use relative URL matching how @vscode/codicons does it
  fontsUrl: '.',
  formatOptions: {},
})

console.log('Done. Commit src/renderer/assets/fonts/restorm-brand.{woff2,css}')
