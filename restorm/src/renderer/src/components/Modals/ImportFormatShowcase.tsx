/**
 * Speech-bubble that pitches one supported import format at a time:
 * format name (with optional `PRO` badge), an optional logo, and a
 * short description. Cycles through the configured formats every 15
 * seconds so a user who lingers on the import modal sees the breadth
 * of what Restorm accepts.
 *
 * Today the rotation engine drives a single entry (Swagger). Adding
 * OpenAPI / Curl / PowerShell / Postman / GraphQL / gRPC / etc. is
 * just an item in the `IMPORT_FORMATS` array below — the rotation
 * timer kicks in automatically once there are 2+ entries.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../common/Badge'
import {
  ElectricBorder,
  MagicCard,
  pickRandomBorderBeamProps,
  pickRandomElectricBorderProps,
  pickRandomMagicCardProps,
  pickRandomShineBorderProps,
  pickRandomBorderEffect,
  type BorderEffectId,
  type BorderBeamProps,
  type ElectricBorderProps,
  type ShineBorderProps
} from 'electron-core-ui/renderer'
// `BorderBeam` and `ShineBorder` are NOT imported as components — we
// hand-roll their markup so we can override `offset-path` (BorderBeam)
// and `mask` (both) to follow the bubble's full silhouette including
// the comic-book tail. `ElectricBorder` and `MagicCard` are rendered
// as the stock components — their visuals (turbulence-displaced border
// + glow / cursor-tracked spotlight) work fine on the rectangular
// border-box without a silhouette mask.
// Vite `?raw` imports return the SVG file content as a string. We
// inline these (instead of loading via `<img>` or CSS `mask-image`)
// so the path inherits the current text colour via `fill="currentColor"`,
// which lets the same asset render dark on a light theme and light
// on a dark theme without shipping per-theme files.
import postmanSvgRaw from '../../../../../assets/imgs/import-sources/postman.svg?raw'
import insomniaSvgRaw from '../../../../../assets/imgs/import-sources/insomnia.svg?raw'
import brunoSvgRaw from '../../../../../assets/imgs/import-sources/bruno.svg?raw'
import websocketSvgRaw from '../../../../../assets/imgs/import-sources/websocket.svg?raw'
import kafkaSvgRaw from '../../../../../assets/imgs/import-sources/kafka.svg?raw'
import socketioSvgRaw from '../../../../../assets/imgs/import-sources/socketio.svg?raw'
import soapSvgRaw from '../../../../../assets/imgs/import-sources/soap.svg?raw'
import './ImportFormatShowcase.css'

/** Time spent on each format before rotating to the next one. */
const ROTATION_INTERVAL_MS = 15_000
/** Fade-in duration (matches the `--in` keyframe in the CSS). */
const FADE_IN_MS = 500
/** Fade-out duration (matches the `--out` keyframe in the CSS). */
const FADE_OUT_MS = 500
/** Time the host stays empty between two consecutive bubbles. */
const GAP_MS = 500
/** Time the bubble sits at full opacity, between fade-in and fade-out. */
const STEADY_MS = ROTATION_INTERVAL_MS - FADE_IN_MS - FADE_OUT_MS - GAP_MS

// Geometry of the bubble silhouette — must stay in sync with the CSS
// (`border-radius` on `.import-format-showcase-bubble` and the tail
// pseudos `::before` / `::after`). Used at runtime to compute the
// silhouette path the BorderBeam decoration follows on PRO bubbles.
const BUBBLE_BORDER_RADIUS = 12
const TAIL_ATTACH_X = 28
const TAIL_WIDTH = 14
const TAIL_DEPTH = 14

/**
 * Build the SVG path that traces the bubble's full silhouette
 * (rounded rectangle + comic-book tail) in the bubble's local
 * coordinate system, with origin at the bubble's top-left corner.
 *
 * The path runs clockwise:
 *   top-left rounded corner → top edge → top-right rounded corner →
 *   right edge → bottom-right rounded corner → bottom edge to tail →
 *   tail right (down to tip) → tail tip → tail left (up to bubble) →
 *   bottom edge to bottom-left rounded corner → left edge → close.
 */
function computeSilhouettePath(width: number, height: number): string {
  const r = BUBBLE_BORDER_RADIUS
  const tx = TAIL_ATTACH_X
  const tw = TAIL_WIDTH
  const td = TAIL_DEPTH
  return `M ${r} 0 H ${width - r} A ${r} ${r} 0 0 1 ${width} ${r} V ${height - r} A ${r} ${r} 0 0 1 ${width - r} ${height} H ${tx + tw} L ${tx} ${height + td} L ${tx} ${height} H ${r} A ${r} ${r} 0 0 1 0 ${height - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`
}

/**
 * Build a `mask-image: url(...)` value pointing at an inline SVG
 * whose only content is the silhouette path stroked black on a
 * transparent canvas. Used to clip the moving BorderBeam trail to a
 * thin band along the silhouette outline (the trail itself is a 60px
 * gradient div whose pixels would otherwise bleed inside the bubble
 * and outside the tail).
 */
function computeSilhouetteMask(path: string, width: number, height: number, strokeWidth = 2): string {
  const svgHeight = height + TAIL_DEPTH
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${svgHeight}' width='${width}' height='${svgHeight}'><path d='${path}' fill='none' stroke='black' stroke-width='${strokeWidth}'/></svg>`
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
}

interface ImportFormat {
  /** Stable id (used as React key). */
  id: string
  /** Display name in the bubble's H1 (no i18n — proper nouns). */
  title: string
  /**
   * Resolved URL of the logo asset, or `null` to render the codicon
   * named in `iconCodicon` (or nothing if both are absent).
   */
  logoSrc: string | null
  /**
   * Codicon glyph name (without the `codicon-` prefix). Used when the
   * format doesn't have a brand SVG worth shipping — e.g. PowerShell
   * uses `terminal-powershell`. Ignored when `logoSrc` is set.
   */
  iconCodicon?: string
  /**
   * Raw SVG markup (Vite `?raw` import) for monochrome glyphs that
   * should pick up the theme's foreground colour. The component
   * injects this with `dangerouslySetInnerHTML` and patches the
   * inner `<path>`'s fill to `currentColor` via CSS, so the same
   * asset reads light on a dark theme and dark on a light theme.
   * When set, takes priority over `logoSrc` / `iconCodicon`.
   */
  inlineSvg?: string
  /**
   * Translation key for the description body. The bubble strips the
   * key off `t(...)` so a missing translation falls back to the key
   * itself, which is good enough for the placeholder formats we add
   * before final copy lands.
   */
  descriptionKey: string
  /**
   * Optional translation key for a small italic disclaimer rendered
   * bottom-right of the bubble. Used to keep nominative-fair-use
   * obligations explicit when a third-party trademark is shown
   * (Postman, Insomnia, etc.).
   */
  trademarkKey?: string
  /** Whether the marketing tier requires a paid plan. */
  isPro: boolean
}

const IMPORT_FORMATS: readonly ImportFormat[] = [
  {
    id: 'swagger',
    title: 'Swagger',
    logoSrc: new URL('../../../../../assets/imgs/import-sources/swagger.svg', import.meta.url).href,
    descriptionKey: 'import.formats.swagger.description',
    trademarkKey: 'import.formats.swagger.trademark',
    isPro: false
  },
  {
    id: 'openapi',
    title: 'OpenAPI',
    logoSrc: new URL('../../../../../assets/imgs/import-sources/openapi.svg', import.meta.url).href,
    descriptionKey: 'import.formats.openapi.description',
    trademarkKey: 'import.formats.openapi.trademark',
    isPro: false
  },
  {
    id: 'curl',
    title: 'cURL',
    logoSrc: new URL('../../../../../assets/imgs/import-sources/curl.svg', import.meta.url).href,
    descriptionKey: 'import.formats.curl.description',
    trademarkKey: 'import.formats.curl.trademark',
    isPro: false
  },
  {
    id: 'powershell',
    title: 'PowerShell',
    logoSrc: new URL('../../../../../assets/imgs/import-sources/powershell.svg', import.meta.url).href,
    descriptionKey: 'import.formats.powershell.description',
    trademarkKey: 'import.formats.powershell.trademark',
    isPro: false
  },
  {
    id: 'postman',
    title: 'Postman',
    logoSrc: null,
    inlineSvg: postmanSvgRaw,
    descriptionKey: 'import.formats.postman.description',
    trademarkKey: 'import.formats.postman.trademark',
    isPro: true
  },
  {
    id: 'insomnia',
    title: 'Insomnia',
    logoSrc: null,
    inlineSvg: insomniaSvgRaw,
    descriptionKey: 'import.formats.insomnia.description',
    trademarkKey: 'import.formats.insomnia.trademark',
    isPro: true
  },
  {
    id: 'bruno',
    title: 'Bruno',
    logoSrc: null,
    inlineSvg: brunoSvgRaw,
    descriptionKey: 'import.formats.bruno.description',
    trademarkKey: 'import.formats.bruno.trademark',
    isPro: true
  },
  {
    id: 'graphql',
    title: 'GraphQL',
    logoSrc: new URL('../../../../../assets/imgs/import-sources/graphql.svg', import.meta.url).href,
    descriptionKey: 'import.formats.graphql.description',
    trademarkKey: 'import.formats.graphql.trademark',
    isPro: true
  },
  {
    id: 'grpc',
    title: 'gRPC',
    logoSrc: new URL('../../../../../assets/imgs/import-sources/grpc.svg', import.meta.url).href,
    descriptionKey: 'import.formats.grpc.description',
    trademarkKey: 'import.formats.grpc.trademark',
    isPro: true
  },
  {
    id: 'soap',
    title: 'SOAP',
    logoSrc: null,
    inlineSvg: soapSvgRaw,
    descriptionKey: 'import.formats.soap.description',
    isPro: true
  },
  {
    id: 'websocket',
    title: 'WebSocket',
    logoSrc: null,
    inlineSvg: websocketSvgRaw,
    descriptionKey: 'import.formats.websocket.description',
    trademarkKey: 'import.formats.websocket.trademark',
    isPro: true
  },
  {
    id: 'kafka',
    title: 'Kafka',
    logoSrc: null,
    inlineSvg: kafkaSvgRaw,
    descriptionKey: 'import.formats.kafka.description',
    trademarkKey: 'import.formats.kafka.trademark',
    isPro: true
  },
  {
    id: 'socketio',
    title: 'Socket.IO',
    logoSrc: null,
    inlineSvg: socketioSvgRaw,
    descriptionKey: 'import.formats.socketio.description',
    trademarkKey: 'import.formats.socketio.trademark',
    isPro: true
  },
  {
    id: 'odata',
    title: 'OData',
    logoSrc: new URL('../../../../../assets/imgs/import-sources/odata.svg', import.meta.url).href,
    descriptionKey: 'import.formats.odata.description',
    isPro: true
  },
  {
    id: 'mqtt',
    title: 'MQTT',
    logoSrc: new URL('../../../../../assets/imgs/import-sources/mqtt.svg', import.meta.url).href,
    descriptionKey: 'import.formats.mqtt.description',
    trademarkKey: 'import.formats.mqtt.trademark',
    isPro: true
  }
]

type Phase = 'in' | 'out' | 'gap'

interface ShowcaseBubbleProps {
  format: ImportFormat
  phase: 'in' | 'out'
}

/**
 * The bubble itself, extracted so it can own its `ResizeObserver` and
 * derive a silhouette path + mask from the live width / height. PRO
 * bubbles draw one of the ECUI border effects (BorderBeam, ShineBorder,
 * MagicCard) chosen at random on every mount — same pattern Vignette
 * uses with `decoration="random"`. BorderBeam and ShineBorder are
 * hand-rolled so we can swap their `offset-path` / `mask` for the
 * silhouette-with-tail variant; MagicCard runs as the stock component
 * since its radial gradient fades naturally past the silhouette.
 */
const ShowcaseBubble: React.FC<ShowcaseBubbleProps> = ({ format, phase }) => {
  const { t } = useTranslation()
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const [silhouette, setSilhouette] = useState<{ offsetPath: string; mask: string } | null>(null)
  // Pick one of the four ECUI border effects (and a coherent set of
  // randomized props for it) once at mount. Re-mounting the bubble for
  // a new format gives a fresh roll, exactly like Vignette's behaviour.
  const [proEffect] = useState<{
    id: BorderEffectId
    beam: BorderBeamProps
    shine: ShineBorderProps
    magic: ReturnType<typeof pickRandomMagicCardProps>
    electric: ElectricBorderProps
  }>(() => ({
    // Excluded from the random pool: ElectricBorder is reserved for
    // high-impact "feature moment" surfaces (e.g. an explicit upgrade
    // CTA) rather than the routine import-bubble rotation. Keep the
    // other three effects in the pool.
    id: pickRandomBorderEffect({ exclude: ['electric-border'] }),
    beam: pickRandomBorderBeamProps(),
    shine: pickRandomShineBorderProps(),
    magic: pickRandomMagicCardProps(),
    electric: pickRandomElectricBorderProps()
  }))

  useLayoutEffect(() => {
    const el = bubbleRef.current
    if (el === null) return

    const update = (): void => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      // The bubble may briefly render with zero dimensions during the
      // very first layout pass on some flex configurations — skip
      // those frames so we never feed `path("M ... 0 0 Z")` to the
      // browser's offset-path parser.
      if (w === 0 || h === 0) return
      const path = computeSilhouettePath(w, h)
      setSilhouette({
        offsetPath: `path("${path}")`,
        mask: computeSilhouetteMask(path, w, h)
      })
    }
    update()

    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => { ro.disconnect() }
  }, [])

  return (
    <div
      ref={bubbleRef}
      className={`import-format-showcase-bubble import-format-showcase-bubble--${phase}${format.isPro ? ' import-format-showcase-bubble--pro' : ''}`}
    >
      <header className="import-format-showcase-header">
        <h1 className="import-format-showcase-title">{format.title}</h1>
        {format.isPro && <Badge type="PRO" />}
      </header>
      <div className="import-format-showcase-body">
        {format.inlineSvg !== undefined ? (
          // Inline SVG so `fill: currentColor` (set in CSS) cascades
          // into the path. Picks up the theme's foreground automatically
          // (light glyph on dark theme, dark glyph on light) without
          // shipping a second per-theme asset.
          <span
            className="import-format-showcase-logo import-format-showcase-logo--monochrome"
            role="img"
            aria-label={`${format.title} logo`}
            dangerouslySetInnerHTML={{ __html: format.inlineSvg }}
          />
        ) : format.logoSrc !== null ? (
          <img
            className="import-format-showcase-logo"
            src={format.logoSrc}
            alt={`${format.title} logo`}
            draggable={false}
          />
        ) : format.iconCodicon !== undefined ? (
          <i
            className={`codicon codicon-${format.iconCodicon} import-format-showcase-codicon`}
            aria-label={`${format.title} logo`}
          />
        ) : null}
        <p className="import-format-showcase-description">
          {t(format.descriptionKey)}
        </p>
      </div>
      {format.trademarkKey !== undefined && (
        <footer className="import-format-showcase-trademark">
          {t(format.trademarkKey)}
        </footer>
      )}
      {/* PRO-only border effect, traced along the *full* silhouette
          (rounded rect + comic-book tail). The decoration container
          extends `bottom: -TAIL_DEPTH` to cover the tail area; the
          inline `mask` (BorderBeam / ShineBorder) is an SVG with the
          silhouette stroked black on a transparent canvas, which
          clips the moving gradient to a thin band along the outline.
          MagicCard's radial gradient fades naturally so it doesn't
          need a silhouette mask — it just gets the bottom extension
          so the spotlight can reach the tail when the user hovers
          near it. */}
      {format.isPro && silhouette !== null &&
        renderProBorderEffect(proEffect, silhouette)}
    </div>
  )
}

/**
 * Renders the PRO-only border effect picked at mount, with the right
 * silhouette overrides depending on the variant.
 */
function renderProBorderEffect(
  proEffect: {
    id: BorderEffectId
    beam: BorderBeamProps
    shine: ShineBorderProps
    magic: ReturnType<typeof pickRandomMagicCardProps>
    electric: ElectricBorderProps
  },
  silhouette: { offsetPath: string; mask: string }
): React.ReactElement {
  if (proEffect.id === 'border-beam') {
    const { beam } = proEffect
    const trailDuration = beam.duration ?? 6
    const trailOffsetSec = ((beam.initialOffset ?? 0) / 100) * trailDuration
    return (
      <div
        className="ecu-border-effect ecu-border-beam"
        style={{
          ['--ecu-border-beam-width' as string]: `${beam.borderWidth ?? 1}px`,
          bottom: `-${TAIL_DEPTH}px`,
          // Replace ECUI's rect-based `mask: linear-gradient(...) padding-box, ... border-box; mask-composite: intersect`
          // with a silhouette-outline mask (single layer → no compose).
          mask: silhouette.mask,
          WebkitMask: silhouette.mask,
          // The 1px transparent border that ECUI's class adds was a
          // clip target for the rect mask — turning it off keeps the
          // silhouette mask from drifting 1px off the actual border.
          border: 'none'
        }}
        aria-hidden="true"
      >
        <div
          className="ecu-border-beam-trail"
          style={{
            width: `${beam.size ?? 50}px`,
            offsetPath: silhouette.offsetPath,
            background: `linear-gradient(to left, ${beam.colorFrom ?? '#ffaa40'}, ${beam.colorTo ?? '#9c40ff'}, transparent)`,
            animationDuration: `${trailDuration}s`,
            animationDelay: `${-(trailOffsetSec + (beam.delay ?? 0))}s`,
            animationDirection: beam.reverse === true ? 'reverse' : 'normal'
          }}
        />
      </div>
    )
  }

  if (proEffect.id === 'shine-border') {
    const { shine } = proEffect
    const colors = Array.isArray(shine.shineColor)
      ? shine.shineColor.join(',')
      : (shine.shineColor ?? '#000000')
    return (
      <div
        className="ecu-border-effect ecu-shine-border"
        style={{
          ['--ecu-shine-border-width' as string]: `${shine.borderWidth ?? 1}px`,
          ['--ecu-shine-border-duration' as string]: `${shine.duration ?? 14}s`,
          backgroundImage: `radial-gradient(transparent, transparent, ${colors}, transparent, transparent)`,
          bottom: `-${TAIL_DEPTH}px`,
          // ECUI's stock ShineBorder uses two `linear-gradient(#fff)`
          // masks composited with `exclude` to keep only the border
          // ring; the silhouette-outline mask achieves the same
          // border-only effect along the actual silhouette.
          mask: silhouette.mask,
          WebkitMask: silhouette.mask,
          maskComposite: 'add',
          WebkitMaskComposite: 'source-over',
          // Drop the inner padding the stock class uses — that padding
          // is part of the rect-mask trick and would offset the shine
          // gradient inside the silhouette.
          padding: 0
        }}
        aria-hidden="true"
      />
    )
  }

  if (proEffect.id === 'magic-card') {
    // Stock component as a direct child of the bubble so its
    // pointer-listener (installed on `parentElement`) tracks the
    // bubble's bounds. The CSS rule
    // `.import-format-showcase-bubble--pro .ecu-magic-card { bottom: -TAIL_DEPTH }`
    // extends the spotlight canvas below the bubble so it can light
    // the tail too.
    return <MagicCard {...proEffect.magic} />
  }

  // 'electric-border' — stock component. The turbulence-displaced
  // border can't easily follow a non-rectangular silhouette (the
  // SVG filter operates on the rendered box), so the wobbly border
  // hugs the bubble's content-box and the comic-book tail keeps its
  // plain border. Kept rectangular by design.
  return <ElectricBorder {...proEffect.electric} borderRadius="12px" />
}

export const ImportFormatShowcase: React.FC = () => {
  const [index, setIndex] = useState(0)
  // `phase` drives the bubble's lifecycle:
  //   'in'  → bubble mounted, fade-in animation, stays full-opacity for STEADY_MS
  //   'out' → bubble still mounted, fade-out animation
  //   'gap' → bubble unmounted, host empty for GAP_MS
  // Single bubble (length <= 1) → phase stays 'in' forever.
  const [phase, setPhase] = useState<Phase>('in')

  useEffect(() => {
    if (IMPORT_FORMATS.length <= 1) return
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const startOut = (): void => {
      if (cancelled) return
      setPhase('out')
      timeoutId = setTimeout(startGap, FADE_OUT_MS)
    }
    const startGap = (): void => {
      if (cancelled) return
      setPhase('gap')
      timeoutId = setTimeout(startNext, GAP_MS)
    }
    const startNext = (): void => {
      if (cancelled) return
      setIndex((prev) => (prev + 1) % IMPORT_FORMATS.length)
      setPhase('in')
      timeoutId = setTimeout(startOut, FADE_IN_MS + STEADY_MS)
    }

    timeoutId = setTimeout(startOut, FADE_IN_MS + STEADY_MS)
    return () => {
      cancelled = true
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }, [])

  const format = IMPORT_FORMATS[index]
  if (format === undefined) return null

  return (
    <div className="import-format-showcase-host" data-testid="import-format-showcase">
      {/* Behind-the-bubble radial halo. Sibling to the bubble (not
          a pseudo) so the bubble's own ::before / ::after pseudos
          stay free for the comic-book tail. */}
      <div className="import-format-showcase-glow" aria-hidden="true" />
      {/* During the `gap` phase the bubble is unmounted entirely so
          the next `in` mount cleanly retriggers the fade-in keyframe.
          `key={format.id}` is redundant with the unmount but keeps
          things safe if we ever shorten the gap to zero. */}
      {phase !== 'gap' && (
        <ShowcaseBubble key={format.id} format={format} phase={phase} />
      )}
    </div>
  )
}
