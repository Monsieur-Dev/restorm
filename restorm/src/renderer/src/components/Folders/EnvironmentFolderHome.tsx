import React from 'react'
import { useTranslation } from 'react-i18next'
import { InputBox, Button, ControlGroup } from 'electron-core-ui/renderer'
import type { EnvironmentFolder } from '../../../../shared/types/collections'
import type { ApiDocumentation } from '../../../../shared/types/apiDocumentation'
import { Badge, type BadgeType } from '../common/Badge'

interface Props {
  folder: EnvironmentFolder
  onSwitchTab: (tabId: string) => void
}

const SOURCE_CONFIG: Record<string, { logo?: string; icon?: string; label: string; color: string }> = {
  swagger: { logo: '/imgs/import-sources/swagger.svg', label: 'OpenAPI / Swagger', color: '#85ea2d' },
  graphql: { logo: '/imgs/import-sources/graphql.svg', label: 'GraphQL', color: '#e535ab' },
  grpc: { logo: '/imgs/import-sources/grpc.svg', label: 'gRPC', color: '#244c5a' },
  wsdl: { icon: 'file-code', label: 'SOAP / WSDL', color: '#0076d6' },
  asyncapi: { icon: 'broadcast', label: 'AsyncAPI', color: '#764abc' },
  postman: { icon: 'mail', label: 'Collection Import', color: '#ff6c37' },
  insomnia: { icon: 'globe', label: 'Collection Import', color: '#4000bf' },
  bruno: { icon: 'beaker', label: 'Collection Import', color: '#f4aa41' },
  curl: { icon: 'terminal', label: 'cURL', color: '#073551' },
  powershell: { icon: 'terminal-powershell', label: 'PowerShell', color: '#012456' },
  url: { icon: 'link', label: 'URL Import', color: '#888' }
}

const EnvironmentFolderHome: React.FC<Props> = ({ folder, onSwitchTab }) => {
  const { t } = useTranslation()
  const apiDoc = (folder as unknown as { apiDocumentation?: ApiDocumentation }).apiDocumentation
  const importSource = folder.importSource
  const sourceConfig = importSource ? SOURCE_CONFIG[importSource] : undefined

  return (
    <div style={{ padding: '32px', maxWidth: 640, margin: '0 auto' }}>

      {/* ── Header: logo + title ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        {sourceConfig && (
          sourceConfig.logo ? (
            <img src={sourceConfig.logo} alt={sourceConfig.label} style={{ width: 48, height: 48, flexShrink: 0 }} />
          ) : sourceConfig.icon ? (
            <div style={{
              width: 48, height: 48, borderRadius: 10, background: sourceConfig.color, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0
            }}>
              <span className={`codicon codicon-${sourceConfig.icon}`} />
            </div>
          ) : null
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>
            {apiDoc?.api.title ?? folder.name}
            {apiDoc?.api.version && (
              <span style={{ fontSize: 12, fontWeight: 400, opacity: 0.5, marginLeft: 8 }}>v{apiDoc.api.version}</span>
            )}
          </h1>
          {sourceConfig && (
            <div style={{ marginTop: 4 }}>
              <span style={{
                background: sourceConfig.color, color: '#fff',
                padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500
              }}>
                {sourceConfig.label}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Separator ── */}
      <hr style={{ border: 'none', borderTop: '1px solid var(--panel-border)', margin: '0 0 20px' }} />

      {/* ── Description ── */}
      {apiDoc?.api.description && (
        <p style={{ margin: '0 0 24px', fontSize: 13, lineHeight: 1.7, opacity: 0.7 }}>
          {apiDoc.api.description.length > 400
            ? `${apiDoc.api.description.slice(0, 400)}…`
            : apiDoc.api.description}
        </p>
      )}

      {/* ── Big action buttons ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
        <ActionButton
          icon="settings-gear"
          label={t('folderView.home.configureEnvs')}
          description={t('folderView.home.configureEnvsDesc')}
          onClick={() => { onSwitchTab('configuration') }}
        />
        <ActionButton
          icon="book"
          label={t('folderView.home.viewDocs')}
          description={t('folderView.home.viewDocsDesc')}
          onClick={() => { onSwitchTab('docs') }}
        />
      </div>

      {/* ── Source URL ── */}
      {apiDoc?.sourceUrl && (
        <div style={{ marginBottom: 32 }}>
          <ControlGroup>
            <InputBox
              value={apiDoc.sourceUrl}
              options={{ type: 'text', ariaLabel: 'Source URL' }}
              disabled
            />
            <Button icon="refresh" options={{ ariaLabel: t('folderView.home.refresh') }}>
              {t('folderView.home.refresh')}
            </Button>
          </ControlGroup>
        </div>
      )}

      {/* ── Favorite requests (static placeholder) ── */}
      <Section title={t('folderView.home.favoriteRequests')} icon="star-full">
        <RequestRow method="GET" path="/pet/findByStatus" name="Finds Pets by status" />
        <RequestRow method="GET" path="/pet/{petId}" name="Find pet by ID" />
      </Section>

      {/* ── Footer: contact + source ── */}
      <div style={{ marginTop: 24, fontSize: 11, opacity: 0.4, display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
        {apiDoc?.api.contact?.email && (
          <span><span className="codicon codicon-mail" style={{ marginRight: 4 }} />{apiDoc.api.contact.email}</span>
        )}
        {apiDoc?.api.license && (
          <span><span className="codicon codicon-law" style={{ marginRight: 4 }} />{apiDoc.api.license.name}</span>
        )}
      </div>
    </div>
  )
}

// ── Action button ──

const ActionButton: React.FC<{ icon: string; label: string; description: string; onClick: () => void }> = ({ icon, label, description, onClick }) => (
  <div
    onClick={onClick}
    style={{
      flex: 1, padding: '20px', borderRadius: 10,
      border: '1px solid var(--panel-border)', background: 'var(--editor-background)',
      cursor: 'pointer', transition: 'border-color 0.15s', textAlign: 'center'
    }}
    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--focusBorder)' }}
    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--panel-border)' }}
  >
    <span className={`codicon codicon-${icon}`} style={{ fontSize: 28, opacity: 0.6, display: 'block', marginBottom: 10 }} />
    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 11, opacity: 0.5 }}>{description}</div>
  </div>
)

// ── Section ──

const Section: React.FC<{ title: string; icon: string; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div style={{ marginBottom: 24 }}>
    <h3 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', opacity: 0.4, letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className={`codicon codicon-${icon}`} style={{ fontSize: 14 }} />
      {title}
    </h3>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {children}
    </div>
  </div>
)

// ── Request row with method badge ──

const RequestRow: React.FC<{ method: string; path: string; name: string }> = ({ method, path, name }) => (
  <div
    style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px',
      borderRadius: 6, cursor: 'pointer', fontSize: 13
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--list-hoverBackground)' }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
  >
    <Badge type={method.toUpperCase() as BadgeType} />
    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
    <span style={{ fontSize: 11, opacity: 0.35, fontFamily: 'monospace' }}>{path}</span>
  </div>
)

export default React.memo(EnvironmentFolderHome)
