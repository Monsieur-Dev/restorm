import React from 'react'
import { useTranslation } from 'react-i18next'
import { Button, MosaicCard } from 'electron-core-ui/renderer'

/**
 * `ImportCard` — the "Import your API" tile of the workbench empty
 * state. The CTA opens the import modal (passed in from `App` via
 * `EmptyBench`). The lead pitches the supported sources; the
 * drag-and-drop hint is intentionally absent until that feature
 * is wired through.
 */
interface ImportCardProps {
  readonly onImport: () => void
}

export const ImportCard: React.FC<ImportCardProps> = ({ onImport }) => {
  const { t } = useTranslation()
  return (
    <MosaicCard
      title={t('emptyBench.importCard.title', 'Import your API')}
      titleBackgroundColor="#e85d4e"
      data-testid="empty-bench-card-import"
    >
      <p className="empty-bench-lead">
        {t(
          'emptyBench.importCard.body',
          'Bring in an OpenAPI / Swagger spec, a GraphQL schema, a Postman / Bruno / Insomnia collection, or paste a curl / PowerShell command. Restorm parses it, builds the folder layout, and lands every endpoint pre-filled.'
        )}
      </p>
      <div className="empty-bench-import-cta">
        <Button
          appearance="rainbow"
          size="xl"
          onClick={onImport}
          data-testid="empty-bench-card-import-button"
        >
          {t('common.import', 'Import')}
        </Button>
      </div>
    </MosaicCard>
  )
}
