import React from 'react'
import { isMacintosh } from '../../hooks/usePlatform'
import SelectBoxNative from './selectBoxNative'
import SelectBoxList from './selectBoxCustom'
import { SelectBoxProps, defaultSelectBoxStyles } from './types'

const SelectBox: React.FC<SelectBoxProps> = ({
  options,
  selected = 0,
  onDidSelect,
  selectBoxOptions,
  styles = defaultSelectBoxStyles,
  className,
  id
}) => {
  // Use native select on macOS unless explicitly overridden
  const useCustomDrawn = selectBoxOptions?.useCustomDrawn ?? false
  const shouldUseNative = isMacintosh && !useCustomDrawn

  if (shouldUseNative) {
    return (
      <SelectBoxNative
        options={options}
        selected={selected}
        onDidSelect={onDidSelect || (() => {})}
        selectBoxOptions={selectBoxOptions || {}}
        styles={styles}
        className={className || ''}
        id={id || ''}
      />
    )
  }

  return (
    <SelectBoxList
      options={options}
      selected={selected}
      onDidSelect={onDidSelect || (() => {})}
      selectBoxOptions={selectBoxOptions || {}}
      styles={styles}
      className={className}
      id={id}
    />
  )
}

export default SelectBox
