import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Toggle, MarkdownViewer } from 'electron-core-ui/renderer'
import { useScenarioCliInfo } from '../../contexts/scenarioRunTargetContext'

/** The file (or folder) name from a full path — keeps the example command short
 * by dropping the leading directories. Handles both `/` and `\` separators. */
function basename(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** Wrap a path in double quotes only when it contains a space, matching how a
 * user would type it into a shell. */
function shellQuote(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p
}

/**
 * Shown at the bottom of the empty-inspector help: the command line to run THIS
 * scenario headlessly (`--run`), syntax-highlighted, with toggles for
 * designating it by name vs id and for the log level (all logs vs user `Log`
 * entries only). Mirrors the `restorm --run …` CLI surface.
 */
export const ScenarioCliHelp: React.FC<{ scenarioName: string; scenarioId: string }> = ({ scenarioName, scenarioId }) => {
  const { t } = useTranslation()
  const cliInfo = useScenarioCliInfo()
  const [byId, setById] = useState(false)
  const [allLogs, setAllLogs] = useState(false)

  // Shortest unambiguous designation (bare name / breadcrumb / index
  // path); falls back to the leaf name when the tree isn't available.
  const runName = cliInfo?.suggestRunTarget(scenarioId) ?? scenarioName
  // The real path of the open project; placeholder only when nothing is open.
  const projectPath = cliInfo?.projectPath
    ? shellQuote(basename(cliInfo.projectPath))
    : t('scenario.cli.projectPlaceholder', '<projet.restorm>')
  const target = byId
    ? `--run ${scenarioId} --by id`
    : `--run "${runName}"`
  // Headless runs require RESTORM_TOKEN. The command shows the env var prefix so
  // the user can copy a paste-ready example directly into their CI configuration.
  // TODO(128.9/128.15): replace the account URL with the real token-management
  // page once the account portal is live.
  const tokenPlaceholder = t('scenario.cli.tokenPlaceholder', '<your_token>')
  const command = `RESTORM_TOKEN=${tokenPlaceholder} restorm --open ${projectPath} ${target} --headless${allLogs ? ' --all-logs' : ''}`

  return (
    <div className="scn-inspector-section scn-cli-help" data-testid="scenario-inspector-cli-help">
      <div className="scn-legend-group-title">{t('scenario.cli.title', 'Lancer en ligne de commande')}</div>
      <p className="scn-cli-help-intro">
        {t('scenario.cli.intro', 'Exécutez ce scénario sans ouvrir l\'application (CI, cron, script) :')}
      </p>
      {/* MarkdownViewer renders the command as a `bash` code block (syntax
          highlighting + its own copy button); the raw command lives in
          `data-command` so tests read it verbatim, unhighlighted. */}
      <div className="scn-cli-help-md nodrag" data-testid="scenario-cli-command" data-command={command}>
        <MarkdownViewer compact value={'```bash\n' + command + '\n```'} />
      </div>
      <div className="scn-cli-help-toggles nodrag">
        <Toggle checked={byId} onChange={setById} data-testid="scenario-cli-by-id">
          {t('scenario.cli.byId', 'Désigner par id')}
        </Toggle>
        <Toggle checked={allLogs} onChange={setAllLogs} data-testid="scenario-cli-all-logs">
          {t('scenario.cli.allLogs', 'Tous les logs')}
        </Toggle>
      </div>
      <p className="scn-cli-help-note">
        {t('scenario.cli.note', '`--out fichier` écrit aussi le run-log dans un fichier.')}
      </p>
      {/* Token discovery: headless runs need a Pro plan + CI token. */}
      <p className="scn-cli-help-note scn-cli-help-token-note">
        {t('scenario.cli.tokenNote', 'A headless run requires a Restorm Pro plan and a CI token.')}{' '}
        <a
          href="https://restorm.app/account"
          target="_blank"
          rel="noopener noreferrer"
          className="scn-cli-help-link"
        >
          {t('scenario.cli.tokenLink', 'Get a token')}
        </a>
      </p>
    </div>
  )
}
