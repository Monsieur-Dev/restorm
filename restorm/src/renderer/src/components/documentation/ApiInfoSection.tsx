import React from 'react'
import type { ApiDocumentation } from '../../../../shared/types/apiDocumentation'

export interface ApiInfoSectionProps {
  /** Full structured documentation. The section pulls from `api`,
   * `server`, `sourceType`, `sourceUrl`. */
  apiDocumentation: ApiDocumentation
}

/**
 * Renders the meta-data that surrounds an imported API — version,
 * contact, license, terms of service, external docs, server
 * connection, source format. Only shown at the env-folder scope
 * (the spec root); folder / single-route scopes inherit through
 * the per-route surface.
 */
export const ApiInfoSection: React.FC<ApiInfoSectionProps> = ({ apiDocumentation }) => {
  const { api, server, sourceType, sourceUrl } = apiDocumentation

  return (
    <dl
      className="documentation-host-api-info"
      data-testid="documentation-host-api-info"
    >
      {api.version !== undefined && api.version.length > 0 && (
        <>
          <dt>Version</dt>
          <dd><code>{api.version}</code></dd>
        </>
      )}

      <>
        <dt>Source format</dt>
        <dd>
          <code>{sourceType}</code>
          {sourceUrl !== undefined && sourceUrl.length > 0 && (
            <>
              {' from '}
              <a href={sourceUrl}>{sourceUrl}</a>
            </>
          )}
        </dd>
      </>

      {server !== undefined && (server.host !== undefined || server.basePath !== undefined || (server.schemes?.length ?? 0) > 0 || server.namespace !== undefined) && (
        <>
          <dt>Server</dt>
          <dd>
            {(server.schemes?.length ?? 0) > 0 && (
              <span>{server.schemes?.join(', ')}://</span>
            )}
            {server.host !== undefined && <code>{server.host}</code>}
            {server.basePath !== undefined && <code>{server.basePath}</code>}
            {server.namespace !== undefined && (
              <span className="documentation-host-api-info__extra"> (namespace <code>{server.namespace}</code>)</span>
            )}
          </dd>
        </>
      )}

      {api.contact !== undefined && (
        <>
          <dt>Contact</dt>
          <dd>
            {api.contact.name !== undefined && api.contact.name.length > 0 && <span>{api.contact.name}</span>}
            {api.contact.email !== undefined && api.contact.email.length > 0 && (
              <>
                {api.contact.name !== undefined && api.contact.name.length > 0 ? ' · ' : ''}
                <a href={`mailto:${api.contact.email}`}>{api.contact.email}</a>
              </>
            )}
            {api.contact.url !== undefined && api.contact.url.length > 0 && (
              <>
                {(api.contact.name !== undefined && api.contact.name.length > 0)
                  || (api.contact.email !== undefined && api.contact.email.length > 0)
                  ? ' · '
                  : ''}
                <a href={api.contact.url}>{api.contact.url}</a>
              </>
            )}
          </dd>
        </>
      )}

      {api.license !== undefined && (
        <>
          <dt>License</dt>
          <dd>
            {api.license.url !== undefined && api.license.url.length > 0
              ? <a href={api.license.url}>{api.license.name ?? api.license.url}</a>
              : api.license.name !== undefined && api.license.name.length > 0
                ? <span>{api.license.name}</span>
                : null}
          </dd>
        </>
      )}

      {api.termsOfService !== undefined && api.termsOfService.length > 0 && (
        <>
          <dt>Terms of service</dt>
          <dd><a href={api.termsOfService}>{api.termsOfService}</a></dd>
        </>
      )}

      {api.externalDocs !== undefined && (
        <>
          <dt>External docs</dt>
          <dd>
            <a href={api.externalDocs.url}>
              {api.externalDocs.description !== undefined && api.externalDocs.description.length > 0
                ? api.externalDocs.description
                : api.externalDocs.url}
            </a>
          </dd>
        </>
      )}

      {Object.values(apiDocumentation.groups).some((g) => g.externalDocs !== undefined) && (
        <>
          <dt>Tag references</dt>
          <dd>
            <ul className="documentation-host-api-info__tag-refs">
              {Object.entries(apiDocumentation.groups)
                .filter(([, g]) => g.externalDocs !== undefined)
                .map(([name, g]) => (
                  <li key={name}>
                    <code>{name}</code>
                    {' — '}
                    <a href={g.externalDocs?.url}>
                      {g.externalDocs?.description !== undefined && g.externalDocs.description.length > 0
                        ? g.externalDocs.description
                        : g.externalDocs?.url}
                    </a>
                  </li>
                ))}
            </ul>
          </dd>
        </>
      )}
    </dl>
  )
}
