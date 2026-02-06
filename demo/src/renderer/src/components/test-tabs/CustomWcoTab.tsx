import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CustomWCO } from 'electron-core-ui/renderer'

interface DemoElectronApi {
  sendAction: (action: 'minimize' | 'maximize' | 'close') => void
  onWindowState: (callback: (state: 'maximized' | 'restored') => void) => void
}

function getElectronApiContainer(): { electronAPI: DemoElectronApi | undefined } {
  return window as unknown as { electronAPI: DemoElectronApi | undefined }
}

const CustomWcoTab: React.FC = () => {
  const { t } = useTranslation()
  const [lastAction, setLastAction] = useState<string | null>(null)

  const windowStateCbsRef = useRef<((state: 'maximized' | 'restored') => void)[]>([])
  const previousApiRef = useRef<DemoElectronApi | undefined>(undefined)

  const api = useMemo<DemoElectronApi>(() => ({
    sendAction: (action) => {
      setLastAction(action)
    },
    onWindowState: (callback) => {
      windowStateCbsRef.current.push(callback)
    }
  }), [])

  useLayoutEffect(() => {
    const container = getElectronApiContainer()
    previousApiRef.current = container.electronAPI
    
    // Use Object.defineProperty to handle read-only properties in web mode
    try {
      Object.defineProperty(window, 'electronAPI', {
        value: api,
        writable: true,
        configurable: true
      })
    } catch {
      // Fallback: try direct assignment if defineProperty fails
      try {
        container.electronAPI = api
      } catch {
        // Silently fail if both methods fail (e.g., in strict web environments)
      }
    }

    return () => {
      windowStateCbsRef.current = []
      // Restore original value using defineProperty
      try {
        Object.defineProperty(window, 'electronAPI', {
          value: previousApiRef.current,
          writable: true,
          configurable: true
        })
      } catch {
        // Fallback: try direct assignment if defineProperty fails
        try {
          container.electronAPI = previousApiRef.current
        } catch {
          // Silently fail if both methods fail
        }
      }
    }
  }, [api])

  const setMaximized = useCallback((): void => {
    for (const cb of windowStateCbsRef.current) {
      cb('maximized')
    }
  }, [])

  const setRestored = useCallback((): void => {
    for (const cb of windowStateCbsRef.current) {
      cb('restored')
    }
  }, [])

  const sectionStyle = useMemo<React.CSSProperties>(() => ({
    padding: 20,
    maxWidth: 1000,
    display: 'grid',
    gap: 18
  }), [])

  const cardStyle = useMemo<React.CSSProperties>(() => ({
    border: '1px solid var(--panel-border)',
    backgroundColor: 'var(--sideBar-background)',
    padding: 16,
    borderRadius: 4,
    display: 'grid',
    gap: 10
  }), [])

  const metaGridStyle = useMemo<React.CSSProperties>(() => ({
    display: 'grid',
    gridTemplateColumns: '240px 1fr',
    gap: 8,
    alignItems: 'center',
    fontSize: 13
  }), [])

  const metaKeyStyle = useMemo<React.CSSProperties>(() => ({
    color: 'var(--descriptionForeground)'
  }), [])

  const instanceBoxStyle = useMemo<React.CSSProperties>(() => ({
    height: 32,
    display: 'flex',
    alignItems: 'center'
  }), [])

  return (
    <div style={sectionStyle}>
      <div style={cardStyle}>
        <h3 style={{ margin: 0 }}>{t('customWco.harness.title')}</h3>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button data-testid="customwco-set-maximized" onClick={setMaximized}>
            {t('customWco.harness.setMaximized')}
          </button>
          <button data-testid="customwco-set-restored" onClick={setRestored}>
            {t('customWco.harness.setRestored')}
          </button>
        </div>

        <div style={metaGridStyle}>
          <div style={metaKeyStyle}>last action</div>
          <div data-testid="customwco-last-action">{lastAction ?? ''}</div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ margin: 0 }}>{t('customWco.harness.instances')}</h3>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={metaKeyStyle}>{t('customWco.harness.linux')}</div>
            <div style={instanceBoxStyle}>
              <CustomWCO data-testid="customwco-linux" platform="linux" />
            </div>
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <div style={metaKeyStyle}>{t('customWco.harness.win32')}</div>
            <div style={instanceBoxStyle}>
              <CustomWCO data-testid="customwco-win32" platform="win32" />
            </div>
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <div style={metaKeyStyle}>{t('customWco.harness.darwin')}</div>
            <div style={instanceBoxStyle}>
              <CustomWCO data-testid="customwco-darwin" platform="darwin" />
            </div>
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <div style={metaKeyStyle}>{t('customWco.harness.other')}</div>
            <div style={instanceBoxStyle}>
              <CustomWCO data-testid="customwco-other" platform="freebsd" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CustomWcoTab
