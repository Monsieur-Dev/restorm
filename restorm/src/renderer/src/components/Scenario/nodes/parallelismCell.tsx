import { Toggle, InputBox } from 'electron-core-ui/renderer'
import type { ScenarioNodeCell } from './ScenarioNodeBoxBase'

/**
 * The parallelism control shared by the iteration nodes (`forEach` / `for`):
 * a checkbox + a bounded count (min 2). Persisted under `config.parallelism`
 * as `{ enabled, count }`; the executor reads the same shape to size the
 * scheduler's bounded-concurrency window (count = 1 when disabled).
 */
export interface ParallelismConfig { enabled: boolean; count: number }

/** Read the persisted parallelism config, clamped to a min of 2. */
export function readParallelism(config: Record<string, unknown>): ParallelismConfig {
  const raw = config['parallelism']
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const count = typeof o['count'] === 'number' && o['count'] >= 2 ? Math.floor(o['count']) : 2
    return { enabled: o['enabled'] === true, count }
  }
  return { enabled: false, count: 2 }
}

/** Build the parallelism row cell (caption + toggle + count). */
export function buildParallelismCell(args: {
  id: string
  config: Record<string, unknown>
  onSetConfig: ((id: string, config: Record<string, unknown>) => void) | undefined
  label: string
  testIdPrefix: string
}): ScenarioNodeCell {
  const { id, config, onSetConfig, label, testIdPrefix } = args
  const par = readParallelism(config)
  return {
    id: 'parallelism',
    content: (
      <div className="scn-foreach-parallelism nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
        <span className="scn-field-caption">{label}</span>
        <Toggle
          checked={par.enabled}
          onChange={(checked) => { onSetConfig?.(id, { parallelism: { enabled: checked, count: par.count } }) }}
          aria-label={label}
          data-testid={`${testIdPrefix}-parallelism-enabled`}
        />
        <InputBox
          value={String(par.count)}
          onChange={(next) => {
            const n = Math.max(2, Math.floor(Number(next) || 2))
            onSetConfig?.(id, { parallelism: { enabled: par.enabled, count: n } })
          }}
          options={{ type: 'number', min: 2, ariaLabel: label }}
          disabled={!par.enabled}
          data-testid={`${testIdPrefix}-parallelism-count`}
        />
      </div>
    )
  }
}
