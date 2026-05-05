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

import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../common/Badge'
// `Vignette` is imported solely to trigger its CSS side effect — the
// `.ecu-vignette-decoration-border-beam*` rules need to be live so
// the PRO bubble border beam below renders. We don't actually mount
// a Vignette; we inline the decoration markup so the bubble keeps
// its comic-book tail.
import { Vignette as _VignetteSideEffect } from 'electron-core-ui/renderer'
void _VignetteSideEffect
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

export const ImportFormatShowcase: React.FC = () => {
  const { t } = useTranslation()
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
      <div
        className={`import-format-showcase-bubble import-format-showcase-bubble--${phase}${format.isPro ? ' import-format-showcase-bubble--pro' : ''}`}
        key={format.id}
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
        {/* PRO-only border beam — same animation primitive ECUI uses
            on the welcome-screen vignettes. The decoration only paints
            on the bubble's rectangular border (the comic-book tail
            is a sibling pseudo-element and stays plain by design). */}
        {format.isPro && (
          <div
            className="ecu-vignette-decoration ecu-vignette-decoration-border-beam"
            style={{ ['--ecu-border-beam-width' as string]: '1px' }}
            aria-hidden="true"
          >
            <div
              className="ecu-vignette-decoration-border-beam-trail"
              style={{
                width: '60px',
                offsetPath: 'rect(0 auto auto 0 round 60px)',
                background: 'linear-gradient(to left, #ffaa40, #9c40ff, transparent)',
                animationDuration: '6s',
                animationDelay: '0s'
              }}
            />
          </div>
        )}
      </div>
      )}
    </div>
  )
}
