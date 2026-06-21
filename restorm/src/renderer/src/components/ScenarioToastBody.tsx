import React from 'react'
import './scenarioToastBody.css'

export type ScenarioToastLevel = 'info' | 'success' | 'warning' | 'error'

/** Codicon glyph + theme colour var per toast level. Each level renders a
 * distinct icon AND colour so the four levels are visually distinguishable. */
const LEVEL_VISUALS: Record<ScenarioToastLevel, { icon: string; colorVar: string }> = {
  info: { icon: 'info', colorVar: 'var(--notificationsInfoIcon-foreground, var(--charts-blue, #3794ff))' },
  success: { icon: 'pass-filled', colorVar: 'var(--testing-iconPassed, var(--charts-green, #89d185))' },
  warning: { icon: 'warning', colorVar: 'var(--notificationsWarningIcon-foreground, var(--charts-yellow, #cca700))' },
  error: { icon: 'error', colorVar: 'var(--notificationsErrorIcon-foreground, var(--charts-red, #f14c4c))' }
}

function normalizeLevel(level: string): ScenarioToastLevel {
  return level === 'success' || level === 'warning' || level === 'error' ? level : 'info'
}

/**
 * Header content for a scenario `toast` — [level codicon] + [title], both bold
 * and coloured per the level. Rendered into the ECUI Toaster's `titleNode` slot
 * so it sits on the SAME row as the close button. When no title is set, the
 * message text is shown alongside the glyph so the level stays visible.
 */
export const ScenarioToastTitle: React.FC<{ title: string; message: string; level: string }> = ({ title, message, level }) => {
  const visuals = LEVEL_VISUALS[normalizeLevel(level)]
  const headerText = title.trim().length > 0 ? title : message
  return (
    <span className="scn-toast-header" style={{ color: visuals.colorVar }}>
      <span className={`codicon codicon-${visuals.icon} scn-toast-icon`} aria-hidden="true" />
      <span className="scn-toast-title">{headerText}</span>
    </span>
  )
}

/**
 * Body content for a scenario `toast` — the message in normal weight, below the
 * coloured header row. Rendered only when a title is set (otherwise the message
 * is promoted to the header by {@link ScenarioToastTitle}).
 */
export const ScenarioToastBody: React.FC<{ title: string; message: string }> = ({ title, message }) => {
  if (title.trim().length === 0) return null
  if (message.trim().length === 0) return null
  return <div className="scn-toast-message">{message}</div>
}
