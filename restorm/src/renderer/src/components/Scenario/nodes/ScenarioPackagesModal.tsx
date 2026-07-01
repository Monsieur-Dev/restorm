import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, InputBox, Modal, ScrollableElement } from 'electron-core-ui/renderer'
import './ScenarioPackagesModal.css'

/** One pinned external dependency of a `code` node (`config.packages`). The
 * version is exact — it is the cache key, so ranges aren't accepted. */
export interface CodePackage {
  name: string
  version: string
}

export interface ScenarioPackagesModalProps {
  isOpen: boolean
  onClose: () => void
  /** The node's current package list. */
  packages: CodePackage[]
  /** Persist a new list (add / remove). */
  onChange: (next: CodePackage[]) => void
  /** Base test id; the list, inputs and buttons derive suffixed ids. */
  dataTestId?: string
}

const samePackage = (a: CodePackage, b: CodePackage): boolean => a.name === b.name && a.version === b.version

/**
 * The `code` node's external-dependencies editor: an ECUI Modal listing the
 * pinned `name@version` packages (scrollable), each removable, plus a name +
 * version add row. All controls are ECUI primitives (Modal / ScrollableElement /
 * InputBox / Button) — no native inputs / buttons / scrollbars.
 *
 * Add reads the inputs' live DOM values (via refs), so a click right after
 * typing never loses a character to the InputBox's change debounce.
 */
export const ScenarioPackagesModal: React.FC<ScenarioPackagesModalProps> = ({ isOpen, onClose, packages, onChange, dataTestId }) => {
  const { t } = useTranslation()
  const testId = dataTestId ?? 'scn-code-packages'
  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const nameRef = useRef<HTMLInputElement | null>(null)
  const versionRef = useRef<HTMLInputElement | null>(null)

  const add = (): void => {
    const nextName = (nameRef.current?.value ?? name).trim()
    const nextVersion = (versionRef.current?.value ?? version).trim()
    if (nextName === '' || nextVersion === '') return
    const candidate = { name: nextName, version: nextVersion }
    if (packages.some((p) => samePackage(p, candidate))) return
    onChange([...packages, candidate])
    setName('')
    setVersion('')
  }

  const remove = (index: number): void => {
    onChange(packages.filter((_, i) => i !== index))
  }

  return (
    <Modal
      title={t('scenario.code.packages.title', 'Packages')}
      isOpen={isOpen}
      onClose={onClose}
      size="dialog"
      scopeToSelector=".restorm-workbench-tab"
      data-testid={`${testId}-modal`}
    >
      <div className="scn-packages-body nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
        <p className="scn-packages-hint">
          {t('scenario.code.packages.hint', 'Pinned external packages, resolved and cached on the first run, then loaded offline. Only pure-language packages are supported (Python: pure-Python wheels); pin the exact version.')}
        </p>
        <ScrollableElement className="scn-packages-list" options={{ horizontal: 'hidden' }}>
          {packages.length === 0
            ? <div className="scn-packages-empty" data-testid={`${testId}-empty`}>{t('scenario.code.packages.empty', 'No packages added yet.')}</div>
            : (
              <ul className="scn-packages-items">
                {packages.map((p, i) => (
                  <li className="scn-packages-item" key={`${p.name}@${p.version}`} data-testid={`${testId}-item`}>
                    <span className="scn-packages-item-label">
                      <span className="scn-packages-item-name">{p.name}</span>
                      <span className="scn-packages-item-at">@</span>
                      <span className="scn-packages-item-version">{p.version}</span>
                    </span>
                    <Button
                      small
                      secondary
                      icon="trash"
                      className="scn-packages-remove"
                      onClick={() => { remove(i) }}
                      options={{ ariaLabel: t('scenario.code.packages.remove', 'Remove {{package}}', { package: `${p.name}@${p.version}` }) }}
                      data-testid={`${testId}-remove-${i}`}
                    />
                  </li>
                ))}
              </ul>
              )}
        </ScrollableElement>
        <div className="scn-packages-add">
          <InputBox
            value={name}
            onChange={setName}
            changeDebounceMs={0}
            inputRef={nameRef as React.RefObject<HTMLInputElement>}
            options={{ placeholder: t('scenario.code.packages.namePlaceholder', 'package name'), ariaLabel: t('scenario.code.packages.name', 'Package name') }}
            data-testid={`${testId}-name`}
          />
          <InputBox
            value={version}
            onChange={setVersion}
            changeDebounceMs={0}
            inputRef={versionRef as React.RefObject<HTMLInputElement>}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            options={{ placeholder: t('scenario.code.packages.versionPlaceholder', 'version'), ariaLabel: t('scenario.code.packages.version', 'Version') }}
            data-testid={`${testId}-version`}
          />
          <Button
            medium
            icon="add"
            className="scn-packages-add-button"
            onClick={add}
            options={{ ariaLabel: t('scenario.code.packages.add', 'Add package') }}
            data-testid={`${testId}-add`}
          />
        </div>
      </div>
    </Modal>
  )
}

export default ScenarioPackagesModal
