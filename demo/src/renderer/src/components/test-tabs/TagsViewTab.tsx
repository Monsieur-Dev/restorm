import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TagsView } from 'electron-core-ui/renderer'

const TagsViewTab: React.FC = () => {
  const { t } = useTranslation()

  const [tags, setTags] = useState<string[]>(() => [
    t('tagsView.harness.initialTagA'),
    t('tagsView.harness.initialTagB')
  ])

  const [changeCount, setChangeCount] = useState(0)
  const [lastChange, setLastChange] = useState('')

  const tagsJson = useMemo(() => JSON.stringify(tags), [tags])

  const onChange = (next: string[]): void => {
    setTags(next)
    setChangeCount((c) => c + 1)
    setLastChange(JSON.stringify(next))
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 900, padding: 20 }}>
      <div data-testid="tagsview-ready">true</div>

      <h3 style={{ fontSize: 16, marginBottom: 0 }}>{t('tagsView.harness.title')}</h3>

      <div style={{ display: 'grid', gap: 10 }}>
        <TagsView
          data-testid="tagsview-basic"
          tags={tags}
          onChange={onChange}
          removeTagLabel={t('tagsView.removeTag')}
        />
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div data-testid="tagsview-change-count">{String(changeCount)}</div>
        <div data-testid="tagsview-last-change">{lastChange}</div>
        <div data-testid="tagsview-tags-json">{tagsJson}</div>
      </div>
    </div>
  )
}

export default TagsViewTab
