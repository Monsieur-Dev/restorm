/**
 * Avatar — a circular user glyph with two variants:
 *  - **image**: renders the supplied `imageUrl` (e.g. a Google profile photo);
 *  - **initials fallback**: when no image is given (or it fails to load), shows
 *    1–2 letters derived from `name` on a deterministic background colour. The
 *    colour is a pure function of the name (same name ⇒ same colour) and the
 *    text colour is auto-computed for contrast, so the fallback stays legible on
 *    every theme (light / dark / high-contrast) without per-theme CSS.
 *
 * @example
 * ```tsx
 * import { Avatar } from 'electron-core-ui/renderer'
 *
 * <Avatar name="Yoann Diguet" />                 // initials "YD"
 * <Avatar name="jane.doe@acme.io" size={20} />   // initials "JD"
 * <Avatar name="Jane" imageUrl="https://…/p.png" />
 * ```
 */

import React, { useState } from 'react'
import { getColorFromString } from '../../utils/colorFromString'
import { getContrastColor } from '../../utils/colorContrast'
import { deriveInitials } from './deriveInitials'
import './avatar.css'

export interface AvatarProps {
  /** Display name or email. Drives the derived initials and the deterministic
   * fallback colour. */
  name: string
  /** Optional image URL (profile photo). When it loads, the image is shown in
   * place of the initials; an image that fails to load falls back to initials. */
  imageUrl?: string | undefined
  /** Diameter in pixels (default 24). The font scales with it. */
  size?: number
  /** Explicit initials override. When omitted they are derived from `name`. */
  initials?: string
  /** Test id applied to the root element. */
  'data-testid'?: string
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  imageUrl,
  size = 24,
  initials,
  'data-testid': testId
}) => {
  // An image that 404s / errors falls back to the initials glyph.
  const [imageFailed, setImageFailed] = useState(false)

  const showImage = Boolean(imageUrl) && !imageFailed
  const letters = initials ?? deriveInitials(name)
  const background = getColorFromString(name)
  const color = getContrastColor(background)

  const dimensionStyle: React.CSSProperties = {
    width: size,
    height: size,
    // Keep the glyph legible as the circle scales — ~42% of the diameter.
    fontSize: Math.round(size * 0.42)
  }

  if (showImage) {
    return (
      <span
        className="ecui-avatar ecui-avatar--image"
        style={dimensionStyle}
        {...(testId !== undefined && { 'data-testid': testId })}
      >
        <img
          className="ecui-avatar-img"
          src={imageUrl}
          alt=""
          draggable={false}
          onError={() => { setImageFailed(true) }}
        />
      </span>
    )
  }

  return (
    <span
      className="ecui-avatar ecui-avatar--initials"
      style={{ ...dimensionStyle, backgroundColor: background, color }}
      {...(testId !== undefined && { 'data-testid': testId })}
    >
      <span className="ecui-avatar-initials" aria-hidden="true">{letters}</span>
    </span>
  )
}
