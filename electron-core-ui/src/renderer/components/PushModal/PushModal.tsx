import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../Modal'
import { Button } from '../Button'
import { InputBox } from '../InputBox'
import { SelectBox } from '../SelectBox'
import type { ISelectData } from '../SelectBox/types'
import { Toggle } from '../Toggle'

export interface PushModalLanguageOption {
  code: string
  name: string
}

export interface PushModalProps {
  isOpen: boolean
  onClose: () => void
  /** The language picker's option list. Generic — the host decides which
   * languages it can generate a commit message in (typically the same set
   * as the app's own UI-language switcher). */
  languages: PushModalLanguageOption[]
  language: string
  /** The host recomputes `title`/`body` from its `CommitMessageEngine`
   * whenever this fires, so both fields auto-update on every language
   * change — this component never regenerates content itself. */
  onLanguageChange: (code: string) => void
  applyLanguageByDefault: boolean
  onApplyLanguageByDefaultChange: (value: boolean) => void
  title: string
  onTitleChange: (value: string) => void
  body: string
  onBodyChange: (value: string) => void
  onPush: () => void
  /** Soft character-count warning threshold for the title field — visual
   * only, never blocks the push. Defaults to 72 (the git subject-line
   * convention). */
  titleSoftLimit?: number
  /** Test id root. Defaults to `push-modal`; every field/button suffixes
   * it (`-language-select`, `-title-input`, `-push-button`, …). */
  'data-testid'?: string
}

/**
 * Non-scoped "Push" modal (not bound to any tab or entity) — the
 * commit + push flow's UI. Fully controlled: the host owns the language
 * selection, the generated title/body (regenerated via its
 * `CommitMessageEngine` on every language change — see
 * `docs/Git/README.md`), and the "apply as default" setting. This
 * component only renders the fields and reports user intent back through
 * its callbacks; it has no notion of git, commits, semantic diffing, or
 * the settings store — those are all host-injected per the ECUI-max split
 * documented alongside the rest of the Git integration.
 */
export const PushModal: React.FC<PushModalProps> = ({
  isOpen,
  onClose,
  languages,
  language,
  onLanguageChange,
  applyLanguageByDefault,
  onApplyLanguageByDefaultChange,
  title,
  onTitleChange,
  body,
  onBodyChange,
  onPush,
  titleSoftLimit = 72,
  'data-testid': dataTestId = 'push-modal'
}) => {
  const { t } = useTranslation()

  const languageOptions = useMemo(
    () => languages.map((lang) => ({ text: lang.name, detail: lang.code.toUpperCase() })),
    [languages]
  )
  const selectedLanguageIndex = languages.findIndex((lang) => lang.code === language)
  const titleOverSoftLimit = title.length >= titleSoftLimit

  return (
    <Modal
      title={t('pushModal.title')}
      isOpen={isOpen}
      onClose={onClose}
      size="dialog"
      data-testid={dataTestId}
    >
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{t('pushModal.languageLabel')}</span>
            <SelectBox
              id={`${dataTestId}-language-select`}
              className={`${dataTestId}-language-select`}
              options={languageOptions}
              selected={selectedLanguageIndex}
              onDidSelect={(data: ISelectData) => {
                const selectedLanguage = languages[data.index]
                if (selectedLanguage) onLanguageChange(selectedLanguage.code)
              }}
              data-testid={`${dataTestId}-language-select`}
            />
          </div>
          <Toggle
            checked={applyLanguageByDefault}
            onChange={(checked) => { onApplyLanguageByDefaultChange(checked) }}
            data-testid={`${dataTestId}-apply-default-toggle`}
          >
            {t('pushModal.applyLanguageByDefault')}
          </Toggle>
        </div>

        <div>
          <span style={{ display: 'block', marginBottom: '4px' }}>{t('pushModal.titleFieldLabel')}</span>
          <InputBox
            value={title}
            onChange={onTitleChange}
            // The soft-limit counter below reads `title.length` from the
            // controlled prop — it needs to move on every keystroke, not
            // after InputBox's default 300ms debounce.
            changeDebounceMs={0}
            options={{ ariaLabel: t('pushModal.titleFieldLabel') }}
            data-testid={`${dataTestId}-title-input`}
          />
          <span
            style={{
              display: 'block',
              marginTop: '4px',
              fontSize: 12,
              textAlign: 'right',
              color: titleOverSoftLimit ? 'var(--inputValidation-errorForeground, #f48771)' : undefined
            }}
            data-testid={`${dataTestId}-title-counter`}
          >
            {title.length}/{titleSoftLimit}
          </span>
        </div>

        <div>
          <span style={{ display: 'block', marginBottom: '4px' }}>{t('pushModal.bodyFieldLabel')}</span>
          <InputBox
            value={body}
            onChange={onBodyChange}
            options={{ flexibleHeight: true, flexibleMaxHeight: 200, ariaLabel: t('pushModal.bodyFieldLabel') }}
            data-testid={`${dataTestId}-body-input`}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button secondary onClick={onClose} data-testid={`${dataTestId}-cancel-button`}>
            {t('pushModal.cancel')}
          </Button>
          <Button onClick={onPush} data-testid={`${dataTestId}-push-button`}>
            {t('pushModal.push')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default PushModal
