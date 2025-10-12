import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface SettingsSearchBarProps {
  onSearch: (query: string) => void
  debounceMs?: number
}

export const SettingsSearchBar: React.FC<SettingsSearchBarProps> = ({
  onSearch,
  debounceMs = 300
}) => {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value
      setValue(newValue)

      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      // Set new timeout for debounced search
      timeoutRef.current = setTimeout(() => {
        onSearch(newValue)
      }, debounceMs)
    },
    [onSearch, debounceMs]
  )

  const handleClear = useCallback(() => {
    setValue('')
    onSearch('')
  }, [onSearch])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return (
    <div className="settings-search-bar">
      <div className="settings-search-bar__container">
        <input
          type="text"
          className="settings-search-bar__input"
          placeholder={t('settings.search')}
          value={value}
          onChange={handleChange}
        />
        <svg
          className="settings-search-bar__icon"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M11.7 10.3l3.6 3.6-.7.7-3.6-3.6c-.8.6-1.9 1-3 1-2.8 0-5-2.2-5-5s2.2-5 5-5 5 2.2 5 5c0 1.1-.4 2.2-1 3zM8 2C5.8 2 4 3.8 4 6s1.8 4 4 4 4-1.8 4-4-1.8-4-4-4z" />
        </svg>
        {value && (
          <button className="settings-search-bar__clear" onClick={handleClear} title="Clear">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

