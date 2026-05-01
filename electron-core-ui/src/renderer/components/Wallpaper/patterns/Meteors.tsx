import React, { useState } from 'react'

// Adapted from Magic UI (MIT) — https://magicui.design/docs/components/meteors

export interface MeteorsProps {
  /** Number of meteors. */
  number?: number
  /** Minimum start delay, in seconds. */
  minDelay?: number
  /** Maximum start delay, in seconds. */
  maxDelay?: number
  /** Minimum lifetime of one meteor, in seconds. */
  minDuration?: number
  /** Maximum lifetime of one meteor, in seconds. */
  maxDuration?: number
  /** Travel angle, in degrees (45 = falling diagonally down-left). */
  angle?: number
  /** Color of the meteor head and trail. */
  color?: string
  /** Length of the meteor trail, in pixels. */
  trailLength?: number
  /** Distance traveled across one full lifetime, in pixels. */
  travelDistance?: number
}

interface Meteor {
  delay: number
  duration: number
  top: string
  left: string
}

function buildMeteors(
  count: number,
  minDelay: number,
  maxDelay: number,
  minDuration: number,
  maxDuration: number
): Meteor[] {
  return Array.from({ length: count }, () => {
    // Mix of two spawn sources so every corner sees meteors fall through it,
    // not just the top edge: 60% drop from above, 40% slide in from the right.
    const fromRightEdge = Math.random() < 0.4
    return {
      delay: Math.random() * (maxDelay - minDelay) + minDelay,
      duration: Math.random() * (maxDuration - minDuration) + minDuration,
      top: fromRightEdge ? `${Math.random() * 75}%` : '-5%',
      left: fromRightEdge ? '105%' : `${-5 + Math.random() * 115}%`
    }
  })
}

export const Meteors: React.FC<MeteorsProps> = ({
  number = 20,
  minDelay = 0.2,
  maxDelay = 1.5,
  minDuration = 4,
  maxDuration = 10,
  angle = 45,
  color = 'currentColor',
  trailLength = 50,
  travelDistance = 800
}) => {
  const [meteors] = useState<Meteor[]>(() =>
    buildMeteors(number, minDelay, maxDelay, minDuration, maxDuration)
  )

  return (
    <div className="ecu-wallpaper-pattern-meteors">
      {meteors.map((m, idx) => (
        <span
          key={idx}
          className="ecu-wallpaper-pattern-meteors-meteor"
          style={{
            ['--ecu-meteor-angle' as string]: `${-angle}deg`,
            ['--ecu-meteor-distance' as string]: `${travelDistance}px`,
            top: m.top,
            left: m.left,
            animationDelay: `${m.delay}s`,
            animationDuration: `${m.duration}s`,
            background: color
          }}
        >
          <div
            className="ecu-wallpaper-pattern-meteors-trail"
            style={{
              width: `${trailLength}px`,
              background: `linear-gradient(to right, ${color}, transparent)`
            }}
          />
        </span>
      ))}
    </div>
  )
}
