import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ProgressBar } from 'electron-core-ui/renderer'

const ProgressBarTab: React.FC = () => {
  const { t } = useTranslation()

  const [onCompleteCount, setOnCompleteCount] = useState(0)
  const [lastCompleteId, setLastCompleteId] = useState('')

  const [doneFromDiscreteMode, setDoneFromDiscreteMode] = useState<'discrete' | 'done'>('discrete')
  const [doneFromInfiniteMode, setDoneFromInfiniteMode] = useState<'infinite' | 'done'>('infinite')

  const lastCompleteText = useMemo(() => lastCompleteId, [lastCompleteId])

  const onComplete = (id: string): void => {
    setOnCompleteCount((c) => c + 1)
    setLastCompleteId(id)
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 900, padding: 20 }}>
      <div data-testid="progressbar-ready">true</div>

      <h3 style={{ fontSize: 16, marginBottom: 0 }}>{t('progressBar.harness.title')}</h3>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <div>{t('progressBar.harness.infinite')}</div>
          <ProgressBar data-testid="progressbar-infinite" mode="infinite" />
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div>{t('progressBar.harness.discrete50')}</div>
          <ProgressBar data-testid="progressbar-discrete-50" mode="discrete" value={50} total={100} />
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div>{t('progressBar.harness.customColor')}</div>
          <ProgressBar
            data-testid="progressbar-custom-color"
            mode="discrete"
            value={75}
            total={100}
            options={{ progressBarBackground: '#ff6b6b' }}
          />
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <div>{t('progressBar.harness.doneFromDiscrete')}</div>
          <button
            type="button"
            data-testid="progressbar-discrete-set-done"
            onClick={() => { setDoneFromDiscreteMode('done') }}
          >
            {t('progressBar.harness.setDone')}
          </button>
          <ProgressBar
            data-testid="progressbar-done-from-discrete"
            mode={doneFromDiscreteMode}
            value={50}
            total={100}
            onComplete={() => { onComplete('progressbar-done-from-discrete') }}
          />
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <div>{t('progressBar.harness.doneFromInfinite')}</div>
          <button
            type="button"
            data-testid="progressbar-infinite-set-done"
            onClick={() => { setDoneFromInfiniteMode('done') }}
          >
            {t('progressBar.harness.setDone')}
          </button>
          <ProgressBar
            data-testid="progressbar-done-from-infinite"
            mode={doneFromInfiniteMode}
            onComplete={() => { onComplete('progressbar-done-from-infinite') }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div data-testid="progressbar-on-complete-count">{String(onCompleteCount)}</div>
        <div data-testid="progressbar-last-complete">{lastCompleteText}</div>
      </div>
    </div>
  )
}

export default ProgressBarTab
