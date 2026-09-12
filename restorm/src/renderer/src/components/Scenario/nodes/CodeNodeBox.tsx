import React, { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Button, InputBox } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioCodeField, type ScenarioCodeLanguage } from './ScenarioCodeField'
import { ScenarioPackagesModal, type CodePackage } from './ScenarioPackagesModal'
import { SegmentedToggle } from './SegmentedToggle'
import { CODE_LANGUAGES, CODE_LANGUAGE_LABELS, DEFAULT_CODE_LANGUAGE } from '../../../../../shared/codeLanguages'

/** Read a `code` node's pinned dependencies from its config, tolerating a
 * malformed bag (only well-formed `{ name, version }` entries survive). */
function readConfigPackages(raw: unknown): CodePackage[] {
  if (!Array.isArray(raw)) return []
  const out: CodePackage[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { name, version } = entry as { name?: unknown; version?: unknown }
    if (typeof name === 'string' && name !== '' && typeof version === 'string' && version !== '') {
      out.push({ name, version })
    }
  }
  return out
}

/** Default + hard cap on the per-node execution budget (seconds), mirroring the
 * `codeExecutor` (which clamps `config.timeout` to [1, 60] s). */
const DEFAULT_TIMEOUT_SEC = 5
const MAX_TIMEOUT_SEC = 60

/** Display labels parallel to {@link CODE_LANGUAGES}, for the language radio. */
const CODE_LANGUAGE_LABEL_LIST = CODE_LANGUAGES.map((l) => CODE_LANGUAGE_LABELS[l])

/**
 * `code` — runs user TypeScript/JavaScript in the QuickJS sandbox. The wired
 * `value` input is exposed as `input`, run variables as `vars`, and the curated
 * standard library as globals; whatever the script returns flows out of `result`.
 * The usage help (input / vars / stdlib / return) lives in the editor modal's
 * "Need help?" tab (`showHelp`), so the node's code preview stays clutter-free.
 */
export const CodeNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const [packagesOpen, setPackagesOpen] = useState(false)
  const config = data.config ?? {}
  const code = typeof config['code'] === 'string' ? config['code'] : ''
  const packages = readConfigPackages(config['packages'])
  const language: ScenarioCodeLanguage = (CODE_LANGUAGES as readonly string[]).includes(config['language'] as string)
    ? (config['language'] as ScenarioCodeLanguage)
    : DEFAULT_CODE_LANGUAGE
  const timeoutSec = typeof config['timeout'] === 'number' && config['timeout'] > 0 ? config['timeout'] : DEFAULT_TIMEOUT_SEC

  const rows: ScenarioNodeCell[] = [
    {
      id: 'value',
      label: t('scenario.code.input', 'input'),
      port: { id: 'value', type: 'target' }
    },
    {
      id: 'language',
      content: (
        <div className="nodrag scn-code-language" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.code.language', 'Langage')}</div>
          <SegmentedToggle
            options={CODE_LANGUAGES}
            labels={CODE_LANGUAGE_LABEL_LIST}
            value={language}
            onChange={(next) => { data.onSetConfig?.(id, { language: next }) }}
            ariaLabel={t('scenario.code.language', 'Langage')}
          />
        </div>
      )
    },
    {
      id: 'code',
      // The script text can also be wired in (the `code` input port wins at run
      // time over this inline editor).
      port: { id: 'code', type: 'target' },
      content: (
        <ScenarioCodeField
          value={code}
          onChange={(next) => { data.onSetConfig?.(id, { code: next }) }}
          language={language}
          caption={t('scenario.code.code', 'code')}
          modalTitle={t('scenario.code.modalTitle', 'Edit code')}
          dataTestId={`scn-code-${id}`}
          packageNames={packages.map((p) => p.name)}
          showHelp
        />
      )
    },
    {
      id: 'timeout',
      content: (
        <div className="nodrag scn-code-timeout" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.code.timeout', 'Timeout (s)')}</div>
          <InputBox
            value={String(timeoutSec)}
            onChange={(next) => {
              const n = Math.min(MAX_TIMEOUT_SEC, Math.max(1, Math.floor(Number(next) || DEFAULT_TIMEOUT_SEC)))
              data.onSetConfig?.(id, { timeout: n })
            }}
            options={{ type: 'number', min: 1, max: MAX_TIMEOUT_SEC, ariaLabel: t('scenario.code.timeout', 'Timeout (s)') }}
            data-testid={`scn-code-${id}-timeout`}
          />
        </div>
      )
    },
    {
      id: 'packages',
      content: (
        <div className="nodrag scn-code-packages-field" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.code.packages.caption', 'Dependencies')}</div>
          <Button
            secondary
            icon="package"
            className="scn-code-packages-button"
            onClick={() => { setPackagesOpen(true) }}
            options={{ ariaLabel: t('scenario.code.packages.manage', 'Manage packages') }}
            data-testid={`scn-code-${id}-packages`}
          >
            {packages.length > 0
              ? <span className="scn-code-packages-badge" data-testid={`scn-code-${id}-packages-badge`}>{t('scenario.code.packages.count', '{{count}} deps', { count: packages.length })}</span>
              : t('scenario.code.packages.addShort', 'Add')}
          </Button>
          <ScenarioPackagesModal
            isOpen={packagesOpen}
            onClose={() => { setPackagesOpen(false) }}
            packages={packages}
            onChange={(next) => { data.onSetConfig?.(id, { packages: next }) }}
            dataTestId={`scn-code-${id}-packages`}
          />
        </div>
      )
    }
  ]

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.code.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}
