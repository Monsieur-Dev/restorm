import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DateTimePicker } from 'electron-core-ui/renderer'

function toUtcIsoMinutes(d: Date): string {
  const iso = d.toISOString()
  return iso.slice(0, 16)
}

const DateTimePickerTab: React.FC = () => {
  const { t } = useTranslation()

  const [value, setValue] = useState<Date | null>(() => new Date(Date.UTC(2024, 0, 15, 12, 34, 0, 0)))
  const [changeCount, setChangeCount] = useState(0)

  const valueUtcIso = useMemo(() => (value ? value.toISOString() : ''), [value])
  const valueUtcIsoMinutes = useMemo(() => (value ? toUtcIsoMinutes(value) : ''), [value])

  const onChange = (next: Date): void => {
    setValue(next)
    setChangeCount((c) => c + 1)
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 900, padding: 20 }}>
      <div data-testid="datetimepicker-ready">true</div>

      <h3 style={{ fontSize: 16, marginBottom: 0 }}>{t('dateTimePicker.harness.title')}</h3>

      <div style={{ display: 'grid', gap: 10 }}>
        <DateTimePicker data-testid="datetimepicker-basic" value={value} onChange={onChange} />
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div data-testid="datetimepicker-change-count">{String(changeCount)}</div>
        <div data-testid="datetimepicker-value-utc-iso">{valueUtcIso}</div>
        <div data-testid="datetimepicker-value-utc-iso-minutes">{valueUtcIsoMinutes}</div>
      </div>

      <h3 style={{ fontSize: 16, marginBottom: 0 }}>
        Configuré avec le dimanche comme premier jour de la semaine.
      </h3>
      <div style={{ display: 'grid', gap: 10 }}>
        <DateTimePicker
          data-testid="datetimepicker-sunday-first"
          value={value}
          onChange={onChange}
          firstDayOfWeek={0}
        />
      </div>
    </div>
  )
}

export default DateTimePickerTab
