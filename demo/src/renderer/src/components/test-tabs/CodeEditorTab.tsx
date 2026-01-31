import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CodeEditor } from 'electron-core-ui/renderer'
import type { CodeEditorRef } from 'electron-core-ui/renderer'

function setDocumentTheme(value: 'dark' | 'light'): void {
  document.documentElement.setAttribute('data-theme', value)
}

function getDocumentTheme(): 'dark' | 'light' {
  const value = document.documentElement.getAttribute('data-theme')
  return value === 'light' ? 'light' : 'dark'
}

const INITIAL_TEXT = 'Hello {{petId}}'

const CodeEditorTab: React.FC = () => {
  const { t } = useTranslation()

  const [lastChange, setLastChange] = useState<string>('')
  const [goToDefinition, setGoToDefinition] = useState<string>('')
  const [mountCalls, setMountCalls] = useState<{ onMount: number; onEditorMount: number }>({ onMount: 0, onEditorMount: 0 })
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>(getDocumentTheme)
  const [editorValueInput, setEditorValueInput] = useState<string>(INITIAL_TEXT)
  const [basicMounted, setBasicMounted] = useState(false)
  const [noDebounceMounted, setNoDebounceMounted] = useState(false)

  const basicRef = useRef<CodeEditorRef>(null)
  const noDebounceRef = useRef<CodeEditorRef>(null)

  const handleToggleTheme = useCallback((): void => {
    const next = themeMode === 'dark' ? 'light' : 'dark'
    setDocumentTheme(next)
    setThemeMode(next)
  }, [themeMode])

  const handlePlaceCursorOnVariable = useCallback((): void => {
    const editor = basicRef.current?.editor
    if (!editor) return

    editor.focus()
    // Put cursor inside the variable name: "petId"
    editor.setPosition({ lineNumber: 1, column: 11 })
  }, [])

  const handleApplyValue = useCallback((target: 'basic' | 'no-debounce'): void => {
    const editor = target === 'basic' ? basicRef.current?.editor : noDebounceRef.current?.editor
    if (!editor) return
    editor.setValue(editorValueInput)
  }, [editorValueInput])

  const handleRunGoToDefinition = useCallback((): void => {
    const editor = basicRef.current?.editor
    if (!editor) return
    const action = editor.getAction('editor.action.goToVariableDefinition')
    void action?.run()
  }, [])

  const sectionStyle = useMemo<React.CSSProperties>(() => ({
    padding: 20,
    maxWidth: 1200,
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
    gridTemplateColumns: '220px 1fr',
    gap: 8,
    alignItems: 'center',
    fontSize: 13
  }), [])

  const metaKeyStyle = useMemo<React.CSSProperties>(() => ({
    color: 'var(--descriptionForeground)'
  }), [])

  const editorBoxStyle = useMemo<React.CSSProperties>(() => ({
    height: 220,
    border: '1px solid var(--panel-border)',
    borderRadius: 4,
    overflow: 'hidden'
  }), [])

  return (
    <div style={sectionStyle}>
      <div style={cardStyle}>
        <h3 style={{ margin: 0 }}>{t('codeEditor.harness.title')}</h3>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button data-testid="codeeditor-toggle-theme" onClick={handleToggleTheme}>
            {t('codeEditor.harness.toggleTheme')}
          </button>
          <button data-testid="codeeditor-place-cursor-var" onClick={handlePlaceCursorOnVariable}>
            {t('codeEditor.harness.placeCursorOnVariable')}
          </button>
          <button data-testid="codeeditor-run-go-to-definition" onClick={handleRunGoToDefinition}>
            {t('codeEditor.harness.runGoToDefinition')}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            data-testid="codeeditor-value-input"
            value={editorValueInput}
            onChange={(e) => { setEditorValueInput(e.target.value) }}
            style={{ minWidth: 320 }}
          />
          <button data-testid="codeeditor-apply-value-basic" onClick={() => { handleApplyValue('basic') }}>
            {t('codeEditor.harness.applyValueBasic')}
          </button>
          <button data-testid="codeeditor-apply-value-no-debounce" onClick={() => { handleApplyValue('no-debounce') }}>
            {t('codeEditor.harness.applyValueNoDebounce')}
          </button>
        </div>

        <div style={metaGridStyle}>
          <div style={metaKeyStyle}>{t('codeEditor.harness.currentTheme')}</div>
          <div data-testid="codeeditor-theme-mode">{themeMode}</div>

          <div style={metaKeyStyle}>{t('codeEditor.harness.ready')}</div>
          <div data-testid="codeeditor-ready">{basicMounted && noDebounceMounted ? 'true' : 'false'}</div>

          <div style={metaKeyStyle}>{t('codeEditor.harness.lastChange')}</div>
          <div data-testid="codeeditor-last-change">{lastChange}</div>

          <div style={metaKeyStyle}>{t('codeEditor.harness.goToDefinition')}</div>
          <div data-testid="codeeditor-go-to-definition">{goToDefinition}</div>

          <div style={metaKeyStyle}>{t('codeEditor.harness.mountCalls')}</div>
          <div data-testid="codeeditor-mount-calls">{JSON.stringify(mountCalls)}</div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ margin: 0 }}>{t('codeEditor.harness.instances')}</h3>

        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <div style={metaKeyStyle}>{t('codeEditor.harness.basic')}</div>
            <div style={editorBoxStyle}>
              <CodeEditor
                ref={basicRef}
                data-testid="codeeditor-basic"
                value={INITIAL_TEXT}
                language="plaintext"
                height="100%"
                width="100%"
                options={{ minimap: { enabled: false }, automaticLayout: true }}
                onGoToDefinition={(variableName) => { setGoToDefinition(variableName) }}
                onMount={() => {
                  setBasicMounted(true)
                  setMountCalls((prev) => ({ ...prev, onMount: prev.onMount + 1 }))
                }}
                onEditorMount={() => { setMountCalls((prev) => ({ ...prev, onEditorMount: prev.onEditorMount + 1 })) }}
                onChange={(v) => { setLastChange(v ?? '') }}
              />
            </div>
          </div>

          <div>
            <div style={metaKeyStyle}>{t('codeEditor.harness.noDebounce')}</div>
            <div style={editorBoxStyle}>
              <CodeEditor
                ref={noDebounceRef}
                data-testid="codeeditor-no-debounce"
                value={INITIAL_TEXT}
                language="plaintext"
                height="100%"
                width="100%"
                changeDebounceMs={0}
                options={{ minimap: { enabled: false }, automaticLayout: true }}
                onMount={() => { setNoDebounceMounted(true) }}
                onChange={(v) => { setLastChange(v ?? '') }}
              />
            </div>
          </div>

          <div>
            <div style={metaKeyStyle}>{t('codeEditor.harness.themeForced')}</div>
            <div style={editorBoxStyle}>
              <CodeEditor
                data-testid="codeeditor-theme-forced"
                value={INITIAL_TEXT}
                language="plaintext"
                height="100%"
                width="100%"
                theme="vs"
                options={{ minimap: { enabled: false }, automaticLayout: true }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CodeEditorTab
export {}
