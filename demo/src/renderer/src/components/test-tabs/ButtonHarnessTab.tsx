import React, { useCallback, useMemo, useState } from 'react'
import { Button, ButtonWithDescription, ButtonWithDropdown, ButtonWithIcon } from 'electron-core-ui/renderer'

interface ClickState {
  count: number
  lastValue: string | null
}

function useClickState(): [ClickState, (value?: string) => void] {
  const [state, setState] = useState<ClickState>({ count: 0, lastValue: null })
  const inc = useCallback((value?: string): void => {
    setState((prev) => ({ count: prev.count + 1, lastValue: value ?? prev.lastValue }))
  }, [])
  return [state, inc]
}

const ButtonHarnessTab: React.FC = () => {
  const [basic, incBasic] = useClickState()
  const [disabled, incDisabled] = useClickState()
  const [keyboard, incKeyboard] = useClickState()
  const [iconProp, incIconProp] = useClickState()
  const [iconInline, incIconInline] = useClickState()
  const [withDescription, incWithDescription] = useClickState()
  const [withIcon, incWithIcon] = useClickState()
  const [dropdownPrimary, incDropdownPrimary] = useClickState()
  const [dropdownAction, setDropdownAction] = useState<string | null>(null)

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

  return (
    <div style={sectionStyle}>
      <div data-testid="button-harness-outside" style={{ height: 1, width: 1 }} />

      <div style={cardStyle}>
        <h3 style={{ margin: 0 }}>Button</h3>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button data-testid="button-basic" onClick={() => { incBasic() }}>
            Basic
          </Button>
          <Button data-testid="button-disabled" disabled onClick={() => { incDisabled() }}>
            Disabled
          </Button>
          <Button data-testid="button-keyboard" onClick={() => { incKeyboard() }}>
            Keyboard
          </Button>
          <Button data-testid="button-icon-prop" icon="save" onClick={() => { incIconProp() }}>
            Save
          </Button>
          <Button data-testid="button-icon-inline" onClick={() => { incIconInline() }}>
            $(play) Start
          </Button>
        </div>

        <div style={metaGridStyle}>
          <div style={metaKeyStyle}>basic click count</div>
          <div data-testid="button-basic-click-count">{String(basic.count)}</div>

          <div style={metaKeyStyle}>disabled click count</div>
          <div data-testid="button-disabled-click-count">{String(disabled.count)}</div>

          <div style={metaKeyStyle}>keyboard click count</div>
          <div data-testid="button-keyboard-click-count">{String(keyboard.count)}</div>

          <div style={metaKeyStyle}>icon prop click count</div>
          <div data-testid="button-icon-prop-click-count">{String(iconProp.count)}</div>

          <div style={metaKeyStyle}>inline icon click count</div>
          <div data-testid="button-icon-inline-click-count">{String(iconInline.count)}</div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ margin: 0 }}>ButtonWithDescription</h3>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <ButtonWithDescription
            data-testid="button-with-description"
            description={'$(rocket) Deploy to production'}
            icon="rocket"
            onClick={() => { incWithDescription() }}
          >
            Deploy
          </ButtonWithDescription>
        </div>

        <div style={metaGridStyle}>
          <div style={metaKeyStyle}>click count</div>
          <div data-testid="button-with-description-click-count">{String(withDescription.count)}</div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ margin: 0 }}>ButtonWithIcon</h3>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <ButtonWithIcon
            data-testid="button-with-icon"
            options={{ disabled: false }}
            icon="play"
            label="Start Process"
            onClick={() => { incWithIcon() }}
          />
        </div>

        <div style={metaGridStyle}>
          <div style={metaKeyStyle}>click count</div>
          <div data-testid="button-with-icon-click-count">{String(withIcon.count)}</div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ margin: 0 }}>ButtonWithDropdown</h3>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <ButtonWithDropdown
            data-testid="button-dropdown"
            options={{
              disabled: false,
              actions: [
                { label: 'Action A', onClick: () => { setDropdownAction('Action A') } },
                { label: 'Action B', onClick: () => { setDropdownAction('Action B') } }
              ]
            }}
            label="Dropdown"
            icon="add"
            onClick={() => { incDropdownPrimary() }}
          />

          <ButtonWithDropdown
            data-testid="button-dropdown-disabled"
            options={{
              disabled: true,
              actions: [
                { label: 'Disabled Action', onClick: () => { setDropdownAction('Disabled Action') } }
              ]
            }}
            label="Disabled Dropdown"
            icon="circle-slash"
            onClick={() => { /* should not fire when disabled */ }}
          />
        </div>

        <div style={metaGridStyle}>
          <div style={metaKeyStyle}>primary click count</div>
          <div data-testid="button-dropdown-primary-click-count">{String(dropdownPrimary.count)}</div>

          <div style={metaKeyStyle}>last action label</div>
          <div data-testid="button-dropdown-action-click-label">{dropdownAction ?? ''}</div>
        </div>
      </div>
    </div>
  )
}

export default ButtonHarnessTab
