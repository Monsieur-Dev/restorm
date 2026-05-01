import React, { useEffect, useRef } from 'react'
import { createNoise3D } from 'simplex-noise'

// Adapted from Aceternity UI (MIT — https://ui.aceternity.com/components/vortex)
// Sized to its container (not window), and the motion fade-in is replaced by
// a CSS opacity transition so we drop one runtime dependency.

export interface VortexProps {
  particleCount?: number
  rangeY?: number
  baseHue?: number
  baseSpeed?: number
  rangeSpeed?: number
  baseRadius?: number
  rangeRadius?: number
  backgroundColor?: string
}

const TAU = 2 * Math.PI

export const Vortex: React.FC<VortexProps> = ({
  particleCount = 500,
  rangeY = 100,
  baseHue = 220,
  baseSpeed = 0.0,
  rangeSpeed = 1.5,
  baseRadius = 1,
  rangeRadius = 2,
  backgroundColor = '#000000'
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return undefined
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    const noise3D = createNoise3D()
    const particlePropCount = 9
    const particlePropsLength = particleCount * particlePropCount
    const baseTTL = 50
    const rangeTTL = 150
    const rangeHue = 100
    const noiseSteps = 3
    const xOff = 0.00125
    const yOff = 0.00125
    const zOff = 0.0005

    let width = 0
    let height = 0
    const center: [number, number] = [0, 0]
    let particleProps = new Float32Array(particlePropsLength)
    let tick = 0

    const rand = (n: number): number => n * Math.random()
    const randRange = (n: number): number => n - rand(2 * n)
    const fadeInOut = (t: number, m: number): number => {
      const hm = 0.5 * m
      return Math.abs(((t + hm) % m) - hm) / hm
    }
    const lerp = (n1: number, n2: number, speed: number): number =>
      (1 - speed) * n1 + speed * n2

    const initParticle = (i: number): void => {
      const x = rand(width)
      const y = center[1] + randRange(rangeY)
      const ttl = baseTTL + rand(rangeTTL)
      const speed = baseSpeed + rand(rangeSpeed)
      const radius = baseRadius + rand(rangeRadius)
      const hue = baseHue + rand(rangeHue)
      particleProps.set([x, y, 0, 0, 0, ttl, speed, radius, hue], i)
    }

    const initParticles = (): void => {
      tick = 0
      particleProps = new Float32Array(particlePropsLength)
      for (let i = 0; i < particlePropsLength; i += particlePropCount) {
        initParticle(i)
      }
    }

    const checkBounds = (x: number, y: number): boolean =>
      x > width || x < 0 || y > height || y < 0

    const drawParticle = (
      x: number,
      y: number,
      x2: number,
      y2: number,
      life: number,
      ttl: number,
      radius: number,
      hue: number
    ): void => {
      ctx.save()
      ctx.lineCap = 'round'
      ctx.lineWidth = radius
      ctx.strokeStyle = `hsla(${hue},100%,60%,${fadeInOut(life, ttl)})`
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.closePath()
      ctx.restore()
    }

    const updateParticle = (i: number): void => {
      const i2 = 1 + i
      const i3 = 2 + i
      const i4 = 3 + i
      const i5 = 4 + i
      const i6 = 5 + i
      const i7 = 6 + i
      const i8 = 7 + i
      const i9 = 8 + i
      const x = particleProps[i] ?? 0
      const y = particleProps[i2] ?? 0
      const n = noise3D(x * xOff, y * yOff, tick * zOff) * noiseSteps * TAU
      const vx = lerp(particleProps[i3] ?? 0, Math.cos(n), 0.5)
      const vy = lerp(particleProps[i4] ?? 0, Math.sin(n), 0.5)
      const life = particleProps[i5] ?? 0
      const ttl = particleProps[i6] ?? 0
      const speed = particleProps[i7] ?? 0
      const x2 = x + vx * speed
      const y2 = y + vy * speed
      const radius = particleProps[i8] ?? 0
      const hue = particleProps[i9] ?? 0

      drawParticle(x, y, x2, y2, life, ttl, radius, hue)

      particleProps[i] = x2
      particleProps[i2] = y2
      particleProps[i3] = vx
      particleProps[i4] = vy
      particleProps[i5] = life + 1

      if (checkBounds(x, y) || life > ttl) initParticle(i)
    }

    const draw = (): void => {
      tick++
      if (width === 0 || height === 0) {
        rafRef.current = requestAnimationFrame(draw)
        return
      }
      ctx.fillStyle = backgroundColor
      ctx.fillRect(0, 0, width, height)
      for (let i = 0; i < particlePropsLength; i += particlePropCount) {
        updateParticle(i)
      }
      rafRef.current = requestAnimationFrame(draw)
    }

    const resize = (): void => {
      const newW = container.clientWidth
      const newH = container.clientHeight
      if (newW === 0 || newH === 0) return
      const sizeChanged = newW !== width || newH !== height
      width = newW
      height = newH
      canvas.width = width
      canvas.height = height
      center[0] = 0.5 * width
      center[1] = 0.5 * height
      if (sizeChanged) initParticles()
    }

    resize()
    rafRef.current = requestAnimationFrame(draw)

    const observer = new ResizeObserver(resize)
    observer.observe(container)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      observer.disconnect()
    }
  }, [
    particleCount,
    rangeY,
    baseHue,
    baseSpeed,
    rangeSpeed,
    baseRadius,
    rangeRadius,
    backgroundColor
  ])

  return (
    <div ref={containerRef} className="ecu-wallpaper-pattern-vortex">
      <canvas ref={canvasRef} className="ecu-wallpaper-pattern-vortex-canvas" aria-hidden="true" />
    </div>
  )
}
