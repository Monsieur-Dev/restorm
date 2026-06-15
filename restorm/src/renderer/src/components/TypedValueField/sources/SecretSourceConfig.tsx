import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { InputBox, SelectBox } from 'electron-core-ui/renderer'
import type { ParamField } from '../../../../../shared/secrets/ValueSource'
import { valueSourceRegistry } from '../../../../../shared/secrets/valueSourceRegistry'
import { SecretValue } from '../../../../../shared/types/valueTypes/SecretValue'

/**
 * Per-source configuration surface for a {@link SecretValue}.
 *
 * Looks the value's descriptor up in the renderer's `valueSourceRegistry`
 * (populated at boot by `registerRendererSources`), then renders either:
 *   - the descriptor's `paramSchema` as ECUI fields (text / password / select),
 *     writing each field into a fresh `value.params`; or
 *   - the custom component named by `descriptor.configComponent`, looked up in
 *     {@link configComponents}.
 *
 * Masking invariant: the resolved plaintext lives main-side and is never read
 * back into the renderer. The only field that touches `value.resolved` is the
 * `envFileSecret` write-field, which sets (never displays) the plaintext the
 * user types so the next save can persist it to `restorm.env`.
 */
export interface SecretSourceConfigProps {
  value: SecretValue
  onChange: (next: SecretValue) => void
  dataTestId?: string | undefined
}

/** A custom config component referenced by `descriptor.configComponent`. */
interface ConfigComponentProps {
  value: SecretValue
  onChange: (next: SecretValue) => void
  dataTestId?: string | undefined
}

/** Clone a SecretValue, preserving its (non-serialised) resolved plaintext. */
function cloneSecret(value: SecretValue, params: Record<string, unknown>): SecretValue {
  const next = new SecretValue(value.source, params)
  if (value.resolved !== undefined) next.resolved = value.resolved
  return next
}

/**
 * `envFileSecret` write-field: a masked password input bound to `value.resolved`
 * — the plaintext the user wants to store. We never surface a resolved value
 * pulled from disk here (the descriptor is `isObject:false`, plaintext stays
 * main-side); this only captures what the user types so the next save writes it
 * into the sibling `restorm.env`.
 */
const EnvFileSecretConfig: React.FC<ConfigComponentProps> = ({ value, onChange, dataTestId }) => {
  const { t } = useTranslation()
  return (
    <div className="secret-source-field">
      <label className="secret-source-field-label">
        {t('secrets.source.envFileSecretLabel', 'Valeur du secret')}
      </label>
      <InputBox
        value={value.resolved ?? ''}
        password
        onChange={(next) => {
          const updated = cloneSecret(value, value.params)
          updated.resolved = next
          onChange(updated)
        }}
        options={{
          type: 'text',
          placeholder: t('secrets.source.envFileSecretPlaceholder', 'Secret value')
        }}
        {...(dataTestId && { 'data-testid': `${dataTestId}-config-envfilesecret` })}
      />
    </div>
  )
}

/** Registry of custom config components, keyed by `descriptor.configComponent`. */
const configComponents: Record<string, React.FC<ConfigComponentProps>> = {
  envFileSecret: EnvFileSecretConfig
}

/** Render a single param-schema field as the matching ECUI control. */
const ParamFieldControl: React.FC<{
  field: ParamField
  value: SecretValue
  onChange: (next: SecretValue) => void
  dataTestId?: string | undefined
}> = ({ field, value, onChange, dataTestId }) => {
  const { t } = useTranslation()
  const current = typeof value.params[field.key] === 'string' ? (value.params[field.key] as string) : ''

  const setParam = (next: string): void => {
    onChange(cloneSecret(value, { ...value.params, [field.key]: next }))
  }

  const testId = dataTestId ? `${dataTestId}-config-param-${field.key}` : undefined

  const control =
    field.kind === 'select' ? (
      <SelectBox
        options={(field.options ?? []).map((o) => ({ text: t(o.labelKey, o.value) }))}
        selected={Math.max(0, (field.options ?? []).findIndex((o) => o.value === current))}
        onDidSelect={(data) => { setParam(field.options?.[data.index]?.value ?? '') }}
        className=""
        id={`secret-param-${field.key}`}
        {...(testId && { 'data-testid': testId })}
      />
    ) : (
      <InputBox
        value={current}
        {...(field.kind === 'password' && { password: true })}
        onChange={setParam}
        options={{
          type: 'text',
          placeholder: field.placeholderKey ? t(field.placeholderKey, '') : t(field.labelKey, field.key)
        }}
        {...(testId && { 'data-testid': testId })}
      />
    )

  return (
    <div className="secret-source-field">
      <label className="secret-source-field-label" htmlFor={`secret-param-${field.key}`}>
        {t(field.labelKey, field.key)}
      </label>
      {control}
    </div>
  )
}

export const SecretSourceConfig: React.FC<SecretSourceConfigProps> = ({ value, onChange, dataTestId }) => {
  const descriptor = useMemo(() => valueSourceRegistry.get(value.source), [value.source])

  if (!descriptor) return null

  if (descriptor.paramSchema && descriptor.paramSchema.length > 0) {
    return (
      <div
        className="secret-source-config"
        {...(dataTestId && { 'data-testid': `${dataTestId}-secret-source-config` })}
      >
        {descriptor.paramSchema.map((field) => (
          <ParamFieldControl
            key={field.key}
            field={field}
            value={value}
            onChange={onChange}
            {...(dataTestId && { dataTestId })}
          />
        ))}
      </div>
    )
  }

  if (descriptor.configComponent) {
    const Custom = configComponents[descriptor.configComponent]
    if (Custom) {
      return <Custom value={value} onChange={onChange} {...(dataTestId && { dataTestId })} />
    }
  }

  return null
}

export default SecretSourceConfig
