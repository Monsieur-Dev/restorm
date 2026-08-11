import React from 'react'
import { isMacintosh } from '../../hooks/usePlatform'
import { SelectBoxNative } from './selectBoxNative'
import { SelectBoxList } from './selectBoxCustom'
import { SelectBoxProps, defaultSelectBoxStyles } from './types'

const SelectBox: React.FC<SelectBoxProps> = ({
  options,
  selected = 0,
  onDidSelect,
  selectBoxOptions,
  styles = defaultSelectBoxStyles,
  className,
  id,
  'data-testid': dataTestId,
  filterThreshold,
  filterPlaceholder,
  filterTestId,
  disabled = false
}) => {
  const testId = dataTestId ?? 'selectbox'
  // Use native select on macOS unless explicitly overridden. Editable
  // (combobox) mode needs the custom-drawn dropdown — a native <select>
  // cannot take free text — so it forces the custom variant everywhere.
  const useCustomDrawn = (selectBoxOptions?.useCustomDrawn ?? false) || (selectBoxOptions?.editable ?? false)
  const shouldUseNative = isMacintosh && !useCustomDrawn

  if (shouldUseNative) {
    return (
      <SelectBoxNative
        options={options}
        selected={selected}
        onDidSelect={onDidSelect ?? (() => { return; })}
        selectBoxOptions={selectBoxOptions ?? {}}
        styles={styles}
        className={className}
        id={id}
        data-testid={testId}
        disabled={disabled}
      />
    )
  }

  return (
    <SelectBoxList
      options={options}
      selected={selected}
      onDidSelect={onDidSelect ?? (() => { return; })}
      selectBoxOptions={selectBoxOptions ?? {}}
      styles={styles}
      className={className}
      id={id}
      data-testid={testId}
      disabled={disabled}
      {...(filterThreshold !== undefined && { filterThreshold })}
      {...(filterPlaceholder !== undefined && { filterPlaceholder })}
      {...(filterTestId !== undefined && { filterTestId })}
    />
  )
}

export { SelectBox }
