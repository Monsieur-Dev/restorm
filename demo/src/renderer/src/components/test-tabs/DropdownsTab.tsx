import React, { useState } from 'react'
import { CustomDropdown } from 'electron-core-ui/renderer'

const DropdownsTab: React.FC = () => {
  // Internal state management
  const [selectValue, setSelectValue] = useState('option1')
  return (
    <div style={{ display: 'grid', gap: '15px', padding: '20px' }}>
        <div>
          <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Custom Dropdown</h3>
          <CustomDropdown
            id="test-dropdown"
            value={selectValue}
            options={[
              { value: 'option1', label: 'Option 1' },
              { value: 'option2', label: 'Option 2' },
              { value: 'option3', label: 'Option 3' },
              { value: 'option4', label: 'Option 4' }
            ]}
            onChange={(value) => {
              setSelectValue(value)
            }}
            placeholder="Select an option"
          />
        </div>

        <div>
          <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Native Select</h3>
          <select
            value={selectValue}
            onChange={(e) => {
              setSelectValue(e.target.value)
            }}
            style={{
              width: '100%',
              maxWidth: '400px',
              padding: '6px 8px',
              backgroundColor: 'var(--dropdown-background)',
              color: 'var(--dropdown-foreground)',
              border: '1px solid var(--dropdown-border)',
              borderRadius: '2px',
              fontSize: '13px',
              fontFamily: 'inherit'
            }}
          >
            <option value="option1">Option 1</option>
            <option value="option2">Option 2</option>
            <option value="option3">Option 3</option>
            <option value="option4">Option 4</option>
          </select>
        </div>
      </div>
  )
}

export default DropdownsTab
