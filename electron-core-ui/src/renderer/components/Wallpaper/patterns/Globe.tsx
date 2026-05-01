import React, { useEffect, useRef } from 'react'
import createGlobe, { type COBEOptions } from 'cobe'

// Adapted from Magic UI (MIT) — https://magicui.design/docs/components/globe
// Pointer-drag smoothing replaces motion's useSpring with a small lerp loop.

const MOVEMENT_DAMPING = 1400

export interface GlobeProps {
  /** Full cobe config; merged with defaults. */
  config?: Partial<COBEOptions>
  className?: string
  style?: React.CSSProperties
}

const DEFAULT_MARKERS: COBEOptions['markers'] = [
  { location: [14.5995, 120.9842], size: 0.03 },
  { location: [19.076, 72.8777], size: 0.1 },
  { location: [23.8103, 90.4125], size: 0.05 },
  { location: [30.0444, 31.2357], size: 0.07 },
  { location: [39.9042, 116.4074], size: 0.08 },
  { location: [-23.5505, -46.6333], size: 0.1 },
  { location: [19.4326, -99.1332], size: 0.1 },
  { location: [40.7128, -74.006], size: 0.1 },
  { location: [34.6937, 135.5022], size: 0.05 },
  { location: [41.0082, 28.9784], size: 0.06 }
]

const DEFAULT_CONFIG: COBEOptions = {
  width: 800,
  height: 800,
  devicePixelRatio: 2,
  phi: 0,
  theta: 0.3,
  dark: 0,
  diffuse: 0.4,
  mapSamples: 16000,
  mapBrightness: 1.2,
  baseColor: [1, 1, 1],
  markerColor: [251 / 255, 100 / 255, 21 / 255],
  glowColor: [1, 1, 1],
  markers: DEFAULT_MARKERS
}

export const Globe: React.FC<GlobeProps> = ({ config, className, style }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const phiRef = useRef(0)
  const widthRef = useRef(0)
  const targetRotationRef = useRef(0)
  const smoothedRotationRef = useRef(0)
  const pointerDownXRef = useRef<number | null>(null)
  const dragStartRotationRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const onResize = (): void => {
      widthRef.current = canvas.offsetWidth || 600
    }

    onResize()
    window.addEventListener('resize', onResize)

    const merged: COBEOptions = {
      ...DEFAULT_CONFIG,
      ...config,
      width: widthRef.current * 2,
      height: widthRef.current * 2
    }

    let globe: ReturnType<typeof createGlobe> | null = null
    let raf = 0
    try {
      globe = createGlobe(canvas, merged)
      canvas.style.opacity = '1'
    } catch {
      // WebGL not available or cobe init failed — leave the canvas blank.
    }

    // cobe v2 dropped the `onRender` callback; we drive the rotation by
    // calling `globe.update(...)` from our own rAF loop instead.
    const tick = (): void => {
      if (!globe) return
      if (pointerDownXRef.current === null) phiRef.current += 0.005
      smoothedRotationRef.current +=
        (targetRotationRef.current - smoothedRotationRef.current) * 0.08
      globe.update({
        phi: phiRef.current + smoothedRotationRef.current,
        width: widthRef.current * 2,
        height: widthRef.current * 2
      })
      raf = requestAnimationFrame(tick)
    }
    if (globe) raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      globe?.destroy()
      window.removeEventListener('resize', onResize)
    }
  }, [config])

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    pointerDownXRef.current = event.clientX
    dragStartRotationRef.current = targetRotationRef.current
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
  }
  const releasePointer = (): void => {
    pointerDownXRef.current = null
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab'
  }
  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (pointerDownXRef.current === null) return
    const delta = event.clientX - pointerDownXRef.current
    targetRotationRef.current = dragStartRotationRef.current + delta / MOVEMENT_DAMPING
  }

  const rootClass = ['ecu-wallpaper-pattern-globe', className].filter(Boolean).join(' ')

  return (
    <div ref={containerRef} className={rootClass} style={style}>
      <canvas
        ref={canvasRef}
        className="ecu-wallpaper-pattern-globe-canvas"
        onPointerDown={handlePointerDown}
        onPointerUp={releasePointer}
        onPointerLeave={releasePointer}
        onPointerCancel={releasePointer}
        onPointerMove={handlePointerMove}
      />
    </div>
  )
}
