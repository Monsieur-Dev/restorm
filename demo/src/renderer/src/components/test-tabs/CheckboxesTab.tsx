import React, { useState } from 'react'
import { Toggle, RadioGroup } from 'electron-core-ui/renderer'

const CheckboxesTab: React.FC = () => {
  // Internal state management
  const [toggleChecked, setToggleChecked] = useState(true)
  const [toggleUnchecked, setToggleUnchecked] = useState(false)
  const [toggleDisabled, setToggleDisabled] = useState(false)
  const [radioValue, setRadioValue] = useState('option1')
  const [disabledRadioIdx, setDisabledRadioIdx] = useState(0)
  const [tooltipsRadioIdx, setTooltipsRadioIdx] = useState(1)
  
  return (
    <div style={{ display: 'grid', gap: '30px', padding: '20px' }}>
        <div>
          <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Toggle Components</h3>
          <div style={{ display: 'grid', gap: '12px' }}>
        <Toggle
          isChecked={toggleChecked}
          onChange={(checked: boolean) => { setToggleChecked(checked) }}
        >
          Toggle (checked)
        </Toggle>

        <Toggle
          isChecked={toggleUnchecked}
          onChange={(checked: boolean) => { setToggleUnchecked(checked) }}
        >
          Toggle (unchecked)
        </Toggle>

        <Toggle
          isChecked={toggleDisabled}
          disabled={true}
          onChange={(checked: boolean) => { setToggleDisabled(checked) }}
        >
          Toggle (disabled)
        </Toggle>
          </div>
        </div>

        <div>
          <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Radio Components</h3>
          <div style={{ display: 'grid', gap: '20px' }}>
            <div>
              <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Basic Radio Group</h4>
              <RadioGroup
                options={{
                  items: [
                    { text: 'Option 1', isActive: radioValue === 'option1' },
                    { text: 'Option 2', isActive: radioValue === 'option2' },
                    { text: 'Option 3', isActive: radioValue === 'option3' }
                  ]
                }}
                onSelect={(index: number) => {
                  setRadioValue(`option${index + 1}`)
                }}
              />
            </div>

            <div>
              <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Radio Group with Disabled Options</h4>
              <RadioGroup
                options={{
                  items: [
                    { text: 'Enabled Option', isActive: disabledRadioIdx === 0 },
                    { text: 'Disabled Option', disabled: true, isActive: disabledRadioIdx === 1 },
                    { text: 'Another Option', isActive: disabledRadioIdx === 2 }
                  ]
                }}
                onSelect={(index: number) => { setDisabledRadioIdx(index) }}
              />
            </div>

            <div>
              <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Radio Group with Tooltips</h4>
              <RadioGroup
                options={{
                  items: [
                    { text: 'Option A', tooltip: 'This is option A', isActive: tooltipsRadioIdx === 0 },
                    { text: 'Option B', tooltip: 'This is option B', isActive: tooltipsRadioIdx === 1 },
                    { text: 'Option C', tooltip: 'This is option C', isActive: tooltipsRadioIdx === 2 }
                  ]
                }}
                onSelect={(index: number) => { setTooltipsRadioIdx(index) }}
              />
            </div>
          </div>
        </div>
      </div>
  )
}

export default CheckboxesTab
