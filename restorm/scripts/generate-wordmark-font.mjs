#!/usr/bin/env node
/**
 * Generate the restorm wordmark font (woff2).
 *
 * The wordmark font is a dedicated, scoped webfont for the welcome-screen
 * wordmark only. It contains:
 *   - The letters e, s, t, o, r, m  — subsetted from Noto Sans Bold (SIL OFL)
 *   - The ⚡R brand glyph            — derived from restorm-logo-no-contour.svg,
 *                                      mapped to codepoint U+0052 ('R')
 *
 * Mapping the brand glyph to 'R' is intentional: this font is applied ONLY to
 * the `.ecu-welcome-screen-wordmark` element, so the wordmark text "Restorm"
 * renders with the ⚡R logo at the first character position. Screen readers see
 * plain text ("Restorm") — no aria-label gymnastics needed.
 *
 * Prerequisites (Python):
 *   pip install fonttools brotli   # or: pip3 install fonttools brotli
 *
 * Inputs (vendored / committed):
 *   build/fonts/NotoSans-Bold.ttf
 *     Noto Sans Bold — SIL Open Font License 1.1
 *     Source: https://fonts.google.com/noto/specimen/Noto+Sans
 *   src/renderer/assets/fonts/src/restorm-logo-no-contour.svg
 *     The ⚡R brand mark (no outer frame)
 *
 * Output (committed generated artifact):
 *   src/renderer/assets/fonts/restorm-wordmark.woff2
 *
 * Re-run after changing the brand SVG or the Noto Bold source:
 *   pnpm generate:wordmark-font
 *
 * This script is on-demand only — NOT wired into the CI/dev build. The .woff2
 * is a committed artifact; CI consumes it without running this script.
 */

import { spawnSync } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const notoSrcPath = resolve(root, 'build/fonts/NotoSans-Bold.ttf')
const svgPath = resolve(root, 'src/renderer/assets/fonts/src/restorm-logo-no-contour.svg')
const outputPath = resolve(root, 'src/renderer/assets/fonts/restorm-wordmark.woff2')

// Inline Python that does all the font work. Keeping it here avoids a separate
// .py file in the repo while ensuring the generation logic is readable.
const pythonScript = `
import sys, io, xml.etree.ElementTree as ET
from fontTools import ttLib
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path
from fontTools.subset import Subsetter, Options

noto_path = sys.argv[1]
svg_path  = sys.argv[2]
out_path  = sys.argv[3]

# ── 1. Load + subset Noto Sans Bold to [R, e, s, t, o, r, m] ─────────────────
opts = Options()
opts.flavor = None           # we'll set woff2 after merging
opts.layout_features = []    # strip unused OpenType features — minimal file size

tt = ttLib.TTFont(noto_path)
subs = Subsetter(options=opts)
# R (0x52), e (0x65), s (0x73), t (0x74), o (0x6F), r (0x72), m (0x6D)
subs.populate(unicodes=[0x52, 0x65, 0x6F, 0x6D, 0x72, 0x73, 0x74])
subs.subset(tt)

upm       = tt['head'].unitsPerEm      # 1000
ascender  = tt['OS/2'].sTypoAscender   # 1069
descender = tt['OS/2'].sTypoDescender  # -293  (negative)
cap_height = tt['OS/2'].sCapHeight     # typically ~714 for Noto Bold
r_advance = tt['hmtx']['R'][0]         # preserve original advance

print(f"  Noto Bold: upm={upm}, asc={ascender}, desc={descender}, cap={cap_height}")
print(f"  R advance width: {r_advance}")

# ── 2. Parse the brand SVG ────────────────────────────────────────────────────
tree = ET.parse(svg_path)
root_el = tree.getroot()
ns_uri = 'http://www.w3.org/2000/svg'

# The SVG viewBox has a non-zero origin: x0,y0,w,h
vb_parts = root_el.get('viewBox', '0 0 100 100').split()
vb_x0, vb_y0 = float(vb_parts[0]), float(vb_parts[1])
vb_w,  vb_h  = float(vb_parts[2]), float(vb_parts[3])

# ── 3. Build the ⚡R glyph via a transform that maps SVG space → font space ───
# Font space: Y=0 at baseline, positive = up; ascender at y=+ascender.
# SVG space:  Y=0 at top of viewBox, positive = down; glyph fills [vb_y0..vb_y0+vb_h].
#
# We want the logo to fill cap-height (top of uppercase letters → baseline):
#   SVG top (vb_y0) → font y = cap_height
#   SVG bottom (vb_y0 + vb_h) → font y = 0  (baseline)
#
# Transform (applied to SVG paths):
#   scale_y = -cap_height / vb_h       (negative: flip Y axis)
#   translate_y = cap_height + vb_y0 * (cap_height / vb_h)
#   scale_x = scale_y (uniform)        (keep aspect ratio)
#   translate_x = centre within R advance

scale = cap_height / vb_h             # uniform scale, positive
# Flip Y: SVG y → font y = cap_height - (svg_y - vb_y0) * scale
#   = cap_height - svg_y * scale + vb_y0 * scale
# Affine matrix (a,b,c,d,e,f) acting on (x,y):
#   x' = a*x + c*y + e
#   y' = b*x + d*y + f
# We need:
#   x' = scale * x + tx
#   y' = -scale * y + ty   where ty = cap_height + vb_y0 * scale
logo_w_in_font = vb_w * scale
tx = (r_advance - logo_w_in_font) / 2 - vb_x0 * scale
ty = cap_height + vb_y0 * scale

transform = (scale, 0, 0, -scale, tx, ty)
print(f"  SVG viewBox: ({vb_x0},{vb_y0}) {vb_w}x{vb_h}")
print(f"  Glyph transform: scale={scale:.4f} tx={tx:.2f} ty={ty:.2f}")

pen  = TTGlyphPen(tt.getGlyphSet())
tpen = TransformPen(pen, transform)

for path_el in root_el.findall(f'{{{ns_uri}}}path'):
    d = path_el.get('d', '')
    if d:
        parse_path(d, tpen)

new_glyph = pen.glyph()
print(f"  Brand glyph: {new_glyph.numberOfContours} contours")

# ── 4. Replace 'R' in the subsetted font with the brand glyph ─────────────────
tt['glyf']['R'] = new_glyph
tt['hmtx']['R'] = (r_advance, 0)   # bounds will be recomputed on save

# ── 5. Patch the font name so it's a distinct family (no conflict with system Noto)
name_table = tt['name']
FAMILY_NAME = 'Restorm Wordmark'
for record in name_table.names:
    if record.nameID == 1:   # Family
        record.string = FAMILY_NAME.encode('utf-16-be')
    elif record.nameID == 4: # Full name
        record.string = f'{FAMILY_NAME} Bold'.encode('utf-16-be')
    elif record.nameID == 6: # PostScript name
        record.string = b'RestormWordmark-Bold'

# ── 6. Save as woff2 ──────────────────────────────────────────────────────────
tt.flavor = 'woff2'
tt.save(out_path)
size_kb = len(open(out_path,'rb').read()) / 1024
print(f"  Saved: {out_path} ({size_kb:.1f} KB)")
print("Done.")
`

// Write the Python script to a temp file and execute it
const tmpScript = join(tmpdir(), 'generate-wordmark-font.py')
writeFileSync(tmpScript, pythonScript)

console.log('Generating restorm wordmark font...')
console.log(`  Noto source: ${notoSrcPath}`)
console.log(`  Logo SVG:    ${svgPath}`)
console.log(`  Output:      ${outputPath}`)

const result = spawnSync('python3', [tmpScript, notoSrcPath, svgPath, outputPath], {
  stdio: 'inherit',
  encoding: 'utf-8'
})

try { unlinkSync(tmpScript) } catch { /* ignore */ }

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

console.log('\nCommit src/renderer/assets/fonts/restorm-wordmark.woff2')
