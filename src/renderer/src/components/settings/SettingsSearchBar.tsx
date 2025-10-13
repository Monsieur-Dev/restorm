import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { VscClearAll } from 'react-icons/vsc'
import { Input } from '../common/Input'

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
        <Input
          variant="search"
          className="settings-search-bar__input"
          placeholder={t('settings.search')}
          value={value}
          onChange={handleChange}
        />
        {value && (
          <button
            className="settings-search-bar__clear"
            onClick={handleClear}
            title={t('settings.clearSearchInput')}
          >
            <VscClearAll />
          </button>
        )}
      </div>
    </div>
  )
}

