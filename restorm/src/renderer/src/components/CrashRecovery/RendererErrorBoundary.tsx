/**
 * The renderer's last line of defence: a React error boundary at the root.
 *
 * Without one, an exception thrown while rendering or mounting unmounts the
 * whole tree and leaves a white window — no message, no way back, and no
 * report, because an error a boundary WOULD have caught never reaches the SDK's
 * global handlers either. This turns that into a message, a report and a
 * restart.
 *
 * It is deliberately the least clever component in the app. It holds one
 * boolean, it does no I/O of its own, and everything it delegates to is written
 * not to throw — because the one thing a boundary must never do is fail while
 * handling a failure. There is no reset path: React cannot re-mount a tree that
 * threw on the way up with any confidence it will not throw again, and offering
 * a "try again" that silently re-crashes would be worse than offering a
 * restart that works.
 */

import React from 'react'
import { captureRendererCrash } from '../../crash/rendererCrashCapture'
import { CrashRecoverySurface } from './CrashRecoverySurface'

export interface RendererErrorBoundaryProps {
  children: React.ReactNode
  /** Notified after the error has been reported. For tests and for the log line
   * — never for recovery, which is the surface's job. */
  onError?: ((error: unknown) => void) | undefined
}

interface RendererErrorBoundaryState {
  crashed: boolean
}

export class RendererErrorBoundary extends React.Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  override state: RendererErrorBoundaryState = { crashed: false }

  static getDerivedStateFromError(): RendererErrorBoundaryState {
    return { crashed: true }
  }

  override componentDidCatch(error: unknown): void {
    // The report goes through the ordinary gated path: armed only with consent,
    // scrubbed in the main process, and shown to the user first when their plan
    // gives them that choice. A no-op when reporting is off.
    captureRendererCrash(error)
    try {
      this.props.onError?.(error)
    } catch {
      // A misbehaving observer must not stop the recovery surface rendering.
    }
  }

  override render(): React.ReactNode {
    if (this.state.crashed) return <CrashRecoverySurface />
    return this.props.children
  }
}
