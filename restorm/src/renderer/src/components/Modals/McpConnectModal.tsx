import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button } from 'electron-core-ui/renderer'
import './McpConnectModal.css'

/** The one-line command that adds Restorm's MCP server to Claude Code. */
const CLAUDE_CODE_COMMAND = 'claude mcp add restorm -- npx -y restorm-mcp'

/** The `mcpServers` block Claude Desktop and Cursor both understand. */
const MCP_JSON = `{
  "mcpServers": {
    "restorm": {
      "command": "npx",
      "args": ["-y", "restorm-mcp"]
    }
  }
}`

interface McpConnectModalProps {
  isOpen: boolean
  onClose: () => void
}

type RunState = 'idle' | 'running' | 'ok' | 'error'

/**
 * "Add Restorm to Claude" — copy-paste (and, for Claude Code, one-click)
 * instructions to connect an AI assistant to this Restorm instance's MCP server.
 * Three stacked sections, one per client. Claude Desktop / Cursor are copy-only
 * (we never write another app's config file); Claude Code also gets a Run button
 * that shells out to `claude mcp add …` — shown only when the `claude` CLI is
 * detected on the PATH (probed via the main process on open).
 */
export const McpConnectModal: React.FC<McpConnectModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<string | null>(null)
  const [claudeCli, setClaudeCli] = useState<boolean | null>(null)
  const [runState, setRunState] = useState<RunState>('idle')
  const [runMessage, setRunMessage] = useState<string>('')

  // Probe for the `claude` CLI once the modal opens, so the Run button only
  // appears when it can actually work.
  useEffect(() => {
    if (!isOpen) return
    const detect = (window as { restorm?: { runtime?: { detectClaudeCli?: () => Promise<boolean> } } }).restorm?.runtime?.detectClaudeCli
    let cancelled = false
    // Fully async (no synchronous setState in the effect body): resolve the
    // probe, or `false` when the bridge is absent, then set the flag.
    void (detect ? detect() : Promise.resolve(false))
      .then((ok) => { if (!cancelled) setClaudeCli(ok) })
      .catch(() => { if (!cancelled) setClaudeCli(false) })
    return () => { cancelled = true }
  }, [isOpen])

  // Reset the run state on close (an event, not an effect), so a reopen starts
  // fresh — the previous run's "Added"/error never lingers.
  const handleClose = useCallback(() => {
    setRunState('idle')
    setRunMessage('')
    onClose()
  }, [onClose])

  const copy = useCallback((key: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      window.setTimeout(() => { setCopied((c) => (c === key ? null : c)) }, 1600)
    }).catch(() => { /* clipboard denied — no-op */ })
  }, [])

  const runClaudeAdd = useCallback(() => {
    const run = (window as { restorm?: { runtime?: { runClaudeAdd?: () => Promise<{ ok: boolean; message?: string }> } } }).restorm?.runtime?.runClaudeAdd
    if (!run) return
    setRunState('running')
    setRunMessage('')
    void run().then((res) => {
      setRunState(res.ok ? 'ok' : 'error')
      if (res.message) setRunMessage(res.message)
    }).catch((err: unknown) => {
      setRunState('error')
      setRunMessage(err instanceof Error ? err.message : String(err))
    })
  }, [])

  const copyLabel = (key: string): string => (copied === key ? t('mcp.connect.copied') : t('mcp.connect.copy'))

  return (
    <Modal title={t('mcp.connect.title')} isOpen={isOpen} onClose={handleClose} size="dialog" dialogWidth={440}>
      <div className="mcp-connect">
        <p className="mcp-connect__intro">{t('mcp.connect.intro')}</p>

        {/* Claude Code — command + copy + (conditional) run */}
        <section className="mcp-connect__section">
          <div className="mcp-connect__head">
            <span className="mcp-connect__client">Claude Code</span>
            <span className="mcp-connect__where">{t('mcp.connect.claudeCode.where')}</span>
          </div>
          <pre className="mcp-connect__code" data-testid="mcp-connect-claude-code">{CLAUDE_CODE_COMMAND}</pre>
          <div className="mcp-connect__actions">
            <Button onClick={() => { copy('cc', CLAUDE_CODE_COMMAND) }} data-testid="mcp-connect-copy-claude-code">
              {copyLabel('cc')}
            </Button>
            {claudeCli && (
              <Button
                icon={runState === 'running' ? 'loading~spin' : 'run'}
                disabled={runState === 'running' || runState === 'ok'}
                onClick={runClaudeAdd}
                data-testid="mcp-connect-run-claude-code"
                className="mcp-connect__run"
              >
                {runState === 'ok' ? t('mcp.connect.added') : t('mcp.connect.run')}
              </Button>
            )}
          </div>
          {runState === 'ok' && <div className="mcp-connect__ok">{t('mcp.connect.runOk')}</div>}
          {runState === 'error' && (
            <div className="mcp-connect__error">{t('mcp.connect.runError')}{runMessage ? ` — ${runMessage}` : ''}</div>
          )}
        </section>

        {/* Claude Desktop — copy-only */}
        <section className="mcp-connect__section">
          <div className="mcp-connect__head">
            <span className="mcp-connect__client">Claude Desktop</span>
            <span className="mcp-connect__where">{t('mcp.connect.claudeDesktop.where')}</span>
          </div>
          <pre className="mcp-connect__code" data-testid="mcp-connect-claude-desktop">{MCP_JSON}</pre>
          <div className="mcp-connect__actions">
            <Button onClick={() => { copy('cd', MCP_JSON) }} data-testid="mcp-connect-copy-claude-desktop">
              {copyLabel('cd')}
            </Button>
          </div>
        </section>

        {/* Cursor — copy-only, same JSON, different file */}
        <section className="mcp-connect__section">
          <div className="mcp-connect__head">
            <span className="mcp-connect__client">Cursor</span>
            <span className="mcp-connect__where">{t('mcp.connect.cursor.where')}</span>
          </div>
          <pre className="mcp-connect__code" data-testid="mcp-connect-cursor">{MCP_JSON}</pre>
          <div className="mcp-connect__actions">
            <Button onClick={() => { copy('cu', MCP_JSON) }} data-testid="mcp-connect-copy-cursor">
              {copyLabel('cu')}
            </Button>
          </div>
        </section>

        <p className="mcp-connect__footnote">{t('mcp.connect.footnote')}</p>
      </div>
    </Modal>
  )
}
