import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CodeEditor, InputBox, MultiSelectCombo, SelectBox, Toggle, type ISelectData } from 'electron-core-ui/renderer'
import type { DesignCodegenTemplate } from '../../../../shared/types/collections'

/** One Copier question, as surfaced by the main process (`copier.yml`). */
interface CopierQuestion {
  key: string
  type: string
  default?: unknown
  help?: string
  choices?: (string | number)[]
  multiselect?: boolean
  multiline?: boolean
  placeholder?: string
  secret?: boolean
}

function toDisplay(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** A multiselect answer as a list of scalar strings (from an array, or empty). */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number').map(String)
}

/** Coerce an edited string back to the question's type (mirrors Copier's typing
 * so the answer reaches the engine as the right JS type). */
function coerce(raw: string, type: string): unknown {
  if (type === 'int') { const n = Number.parseInt(raw, 10); return Number.isNaN(n) ? raw : n }
  if (type === 'float') { const n = Number.parseFloat(raw); return Number.isNaN(n) ? raw : n }
  return raw
}

/**
 * The Copier QUESTIONS of one configured template — the template's own
 * whole-generation parametrization (e.g. `project_slug`), distinct from the
 * per-entity `.vars.` codegen variables. Each question is shown with its label
 * (+ help) and, below, the answer pre-filled from the output folder's saved
 * `.copier-answers.yml` (Copier round-trip) — falling back to the `copier.yml`
 * default. Answers are NOT stored on the design; they live in that file, so
 * changing the output folder reloads the answers from there.
 */
export const DesignTemplateQuestions: React.FC<{
  template: DesignCodegenTemplate
  /** Lifted so the parent can pass the current answers to `generate`. */
  onAnswersChange: (templateId: string, answers: Record<string, unknown>) => void
}> = ({ template, onAnswersChange }) => {
  const { t } = useTranslation()
  const [questions, setQuestions] = useState<CopierQuestion[] | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})

  const report = useCallback(
    (next: Record<string, unknown>) => { onAnswersChange(template.id, next) },
    [onAnswersChange, template.id]
  )

  // Declared questions (fetches only copier.yml, cached in the main process).
  useEffect(() => {
    let cancelled = false
    // Absent until an app restart picks up the preload change — leave questions
    // null (the section renders nothing) rather than setState synchronously here.
    const getQuestions = window.restorm?.designCodegen.getQuestions
    if (typeof getQuestions !== 'function') return
    void getQuestions(template.source)
      .then((r) => { if (!cancelled) setQuestions(r.success && r.questions !== undefined ? r.questions : []) })
      .catch(() => { if (!cancelled) setQuestions([]) })
    return () => { cancelled = true }
  }, [template.source])

  // Seed the answers: saved value from the output folder's .copier-answers.yml
  // if present, else the copier.yml default. Re-runs when the output folder
  // changes, so switching targets reloads that folder's answers.
  const outputDir = (template.outputDir ?? '').trim()
  useEffect(() => {
    if (questions === null) return
    let cancelled = false
    // Always resolve the saved answers through a Promise (empty when there is no
    // output folder yet) so state is only set from an async callback.
    const readAnswers = window.restorm?.designCodegen.readAnswers
    const load: Promise<Record<string, unknown>> = outputDir === '' || typeof readAnswers !== 'function'
      ? Promise.resolve({})
      : readAnswers(outputDir).then((r) => (r.success && r.answers !== undefined ? r.answers : {})).catch(() => ({}))
    void load.then((saved) => {
      if (cancelled) return
      const next: Record<string, unknown> = {}
      for (const q of questions) next[q.key] = q.key in saved ? saved[q.key] : q.default
      setValues(next)
      report(next)
    })
    return () => { cancelled = true }
  }, [questions, outputDir, report])

  const setValue = useCallback((key: string, value: unknown): void => {
    setValues((prev) => {
      const next = { ...prev, [key]: value }
      report(next)
      return next
    })
  }, [report])

  if (questions === null || questions.length === 0) return null

  return (
    <div className="design-code-questions" data-testid={`design-code-questions-${template.id}`}>
      <h4 className="design-settings-group-title">{t('design.code.questions.title', 'Template questions')}</h4>
      {questions.map((q) => (
        <div key={q.key} className="design-code-question" data-testid={`design-code-question-${template.id}-${q.key}`}>
          <div className="design-field">
            <span className="design-field-label">{q.key}</span>
            {q.help !== undefined && q.help !== '' && (
              <span className="design-code-question-help">{q.help}</span>
            )}
            {q.type === 'bool'
              ? (
                <Toggle
                  checked={values[q.key] === true || values[q.key] === 'true'}
                  onChange={(checked) => { setValue(q.key, checked) }}
                  aria-label={q.key}
                  data-testid={`design-code-answer-${template.id}-${q.key}`}
                />
                )
              : q.multiselect === true && q.choices !== undefined && q.choices.length > 0
                ? (
                  <MultiSelectCombo
                    options={q.choices.map((c) => ({ value: String(c), label: String(c) }))}
                    selected={toStringList(values[q.key])}
                    onChange={(next) => { setValue(q.key, next) }}
                    placeholder={q.placeholder ?? q.key}
                    data-testid={`design-code-answer-${template.id}-${q.key}`}
                  />
                  )
                : q.choices !== undefined && q.choices.length > 0
                  ? (
                    <SelectBox
                      id={`design-code-answer-${template.id}-${q.key}`}
                      className=""
                      options={q.choices.map((c) => ({ text: String(c) }))}
                      selected={Math.max(0, q.choices.findIndex((c) => String(c) === toDisplay(values[q.key])))}
                      onDidSelect={(data: ISelectData) => {
                        const picked = q.choices?.[data.index]
                        if (picked !== undefined) setValue(q.key, picked)
                      }}
                      selectBoxOptions={{ ariaLabel: q.key, useCustomDrawn: true }}
                      data-testid={`design-code-answer-${template.id}-${q.key}`}
                    />
                    )
                  : q.type === 'json' || q.type === 'yaml'
                    ? (
                      <div className="design-code-answer-editor" data-testid={`design-code-answer-${template.id}-${q.key}`}>
                        <CodeEditor
                          value={toDisplay(values[q.key])}
                          language={q.type}
                          height="120px"
                          onChange={(value) => { setValue(q.key, value ?? '') }}
                          options={{ minimap: { enabled: false }, lineNumbers: 'off', scrollBeyondLastLine: false, folding: false }}
                        />
                      </div>
                      )
                    : (
                      <InputBox
                        value={toDisplay(values[q.key])}
                        onChange={(value) => { setValue(q.key, coerce(value, q.type)) }}
                        options={{
                          type: 'text',
                          ariaLabel: q.key,
                          ...(q.placeholder !== undefined ? { placeholder: q.placeholder } : {})
                        }}
                        data-testid={`design-code-answer-${template.id}-${q.key}`}
                      />
                      )}
          </div>
        </div>
      ))}
    </div>
  )
}
