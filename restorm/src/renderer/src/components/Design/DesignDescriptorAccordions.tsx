import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CodeEditor } from 'electron-core-ui/renderer'
import type { DesignDescriptor } from '../../services/designDescriptors'

/**
 * The active descriptors of a served design, as accordion blocks: the header
 * carries the full resolved URL (copyable, not a live link — these point at the
 * local mock), and expanding one reveals the descriptor content in a read-only
 * code editor. Content is computed locally from the design, so opening a block
 * is instant and needs no network round-trip.
 */
export const DesignDescriptorAccordions: React.FC<{ descriptors: DesignDescriptor[] }> = ({ descriptors }) => {
  const { t } = useTranslation()
  const [openProtocol, setOpenProtocol] = useState<string | null>(null)
  const [copiedProtocol, setCopiedProtocol] = useState<string | null>(null)

  const copyUrl = useCallback((protocol: string, url: string) => {
    void navigator.clipboard.writeText(url)
    setCopiedProtocol(protocol)
    window.setTimeout(() => { setCopiedProtocol((current) => (current === protocol ? null : current)) }, 1200)
  }, [])

  if (descriptors.length === 0) return null

  return (
    <div className="design-descriptors" data-testid="design-descriptors">
      {descriptors.map((descriptor) => {
        const open = openProtocol === descriptor.protocol
        return (
          <div
            key={descriptor.protocol}
            className={`design-descriptor${open ? ' design-descriptor-open' : ''}`}
            data-testid={`design-descriptor-${descriptor.protocol}`}
          >
            <div className="design-descriptor-head">
              <button
                type="button"
                className="design-descriptor-toggle"
                aria-expanded={open}
                onClick={() => { setOpenProtocol(open ? null : descriptor.protocol) }}
                data-testid={`design-descriptor-toggle-${descriptor.protocol}`}
              >
                <span className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} aria-hidden="true" />
                <span className="design-descriptor-proto">{t(`design.protocol.${descriptor.protocol}`)}</span>
                <code className="design-descriptor-url">{descriptor.url}</code>
              </button>
              <button
                type="button"
                className="design-descriptor-copy"
                aria-label={t('design.descriptors.copy', 'Copy the URL')}
                title={t('design.descriptors.copy', 'Copy the URL')}
                onClick={() => { copyUrl(descriptor.protocol, descriptor.url) }}
                data-testid={`design-descriptor-copy-${descriptor.protocol}`}
              >
                <span className={`codicon codicon-${copiedProtocol === descriptor.protocol ? 'check' : 'copy'}`} aria-hidden="true" />
              </button>
            </div>
            {open && (
              <div className="design-descriptor-body">
                <CodeEditor
                  value={descriptor.content}
                  language={descriptor.language}
                  height="320px"
                  onChange={() => { /* read-only */ }}
                  options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, wordWrap: 'on' }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
