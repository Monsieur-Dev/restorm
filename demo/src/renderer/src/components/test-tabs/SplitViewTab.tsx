import React from 'react'
import { SplitView, Pane, Button } from 'electron-core-ui/renderer'

const SplitViewTab: React.FC = () => {
  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        height: '100%'
      }}
    >
      {/* Left sidebar with vertical stack of panes (like GITABLE / OUTLINE / TIMELINE) */}
      <div
        style={{
          width: 260,
          minWidth: 200,
          maxWidth: 400,
          borderRight: '1px solid var(--ecui-panel-border)',
          backgroundColor: 'var(--ecui-sideBar-background)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          height: '100%'
        }}
      >
        <SplitView
          orientation="vertical"
          style={{ width: '100%', height: '100%' }}
        >
          <Pane
            title="Red"
            initialSize={0.5}
            collapsed={false}
            minSize={100}
            headerActions={(
              <div style={{ display: 'flex', gap: 4 }}>
                <Button
                  small
                  options={{ ariaLabel: 'Add', title: 'Add' }}
                >
                  <i className="codicon codicon-add" />
                </Button>
                <Button
                  small
                  options={{ ariaLabel: 'Remove', title: 'Remove' }}
                >
                  <i className="codicon codicon-remove" />
                </Button>
              </div>
            )}
          >
            <div style={{ width: '100%', height: '100%', minHeight: '100px', backgroundColor: 'red' }} />
          </Pane>
          <Pane title="Green" initialSize={0.25} collapsed={true} minSize={100}>
            <div style={{ width: '100%', height: '100%', backgroundColor: 'green' }} />
          </Pane>
          <Pane title="Blue" initialSize={0.25} collapsed={true} minSize={100}>
            <div style={{ width: '100%', height: '100%', backgroundColor: 'blue' }} />
          </Pane>
          <Pane title="Cyan" collapsed={true} minSize={100}>
            <div style={{ width: '100%', height: '100%', backgroundColor: 'cyan' }} />
          </Pane>
          <Pane title="Magenta" collapsed={true} minSize={100}>
            <div style={{ width: '100%', height: '100%', backgroundColor: 'magenta' }} />
          </Pane>
          <Pane title="Yellow" collapsed={true} minSize={100}>
            <div style={{ width: '100%', height: '100%', backgroundColor: 'yellow' }} />
          </Pane>
          <Pane title="Orange" collapsed={true} minSize={100}>
            <div style={{ width: '100%', height: '100%', backgroundColor: 'orange' }} />
          </Pane>
          <Pane title="Purple" collapsed={true} minSize={100}>
            <div style={{ width: '100%', height: '100%', backgroundColor: 'purple' }} />
          </Pane>
          <Pane title="Gray" collapsed={true} minSize={100}>
            <div style={{ width: '100%', height: '100%', backgroundColor: 'gray' }} />
          </Pane>
        </SplitView>
      </div>

      {/* Simple editor placeholder on the right */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          backgroundColor: 'var(--ecui-editor-background)',
          color: 'var(--ecui-editor-foreground)',
          padding: '16px'
        }}
      >
        <h3 style={{ marginTop: 0 }}>Editor area</h3>
        <p style={{ fontSize: 13, color: 'var(--ecui-descriptionForeground)' }}>
          This area represents the editor. The SplitView on the left reuses the same layout
          primitives as VS Code to stack multiple panes vertically.
        </p>
      </div>
    </div>
  )
}

export default SplitViewTab


