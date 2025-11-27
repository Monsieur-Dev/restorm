import React from 'react'
import { ScrollableElement } from 'electron-core-ui/renderer'

const ScrollbarsTab: React.FC = () => {
  return (
    <div style={{ display: 'grid', gap: '20px', maxWidth: '800px', padding: '20px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>VSCode ScrollableElement Components</h3>
        
        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Scrollable Content (Vertical)</h4>
          <ScrollableElement
            options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
            style={{ height: '200px', width: '400px', border: '1px solid var(--vscode-panel-border)' }}
          >
            <div style={{ height: '600px', padding: '20px', backgroundColor: 'var(--vscode-editor-background)' }}>
              <h5 style={{ margin: '0 0 10px 0' }}>Long Content</h5>
              <p>This is a long content area that demonstrates vertical scrolling.</p>
              <p>You can scroll up and down to see more content.</p>
              <p>The scrollbar will appear automatically when needed.</p>
              <p>It will hide after a few seconds of inactivity.</p>
              <p>Hover over the content to show the scrollbar again.</p>
              <p>This content is much taller than the container.</p>
              <p>Scroll to see all the content below.</p>
              <p>More content here...</p>
              <p>Even more content...</p>
              <p>Keep scrolling...</p>
              <p>Almost at the end...</p>
              <p>Final content at the bottom!</p>
            </div>
          </ScrollableElement>
          <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
            Vertical scrolling with auto-hide scrollbar and shadows
          </p>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Scrollable Content (Both Axes)</h4>
          <ScrollableElement
            options={{
              vertical: 'auto',
              horizontal: 'auto',
              verticalHasArrows: true,
              horizontalHasArrows: true,
              useShadows: true
            }}
            style={{ height: '200px', width: '400px', border: '1px solid var(--vscode-panel-border)' }}
          >
            <div style={{ width: '800px', height: '600px', padding: '20px', backgroundColor: 'var(--vscode-editor-background)' }}>
              <h5 style={{ margin: '0 0 10px 0' }}>Wide and Tall Content</h5>
              <p>This content is both wider and taller than the container.</p>
              <p>You can scroll both horizontally and vertically.</p>
              <p>The scrollbars have arrow buttons for precise navigation.</p>
              <p>Hover to see the scrollbars appear.</p>
              <p>This demonstrates both horizontal and vertical scrolling.</p>
              <p>Content continues to the right...</p>
              <p>And also continues downward...</p>
              <p>You can scroll in all directions.</p>
              <p>More content in all directions...</p>
              <p>Keep scrolling to explore...</p>
              <p>This is a comprehensive scrolling example.</p>
            </div>
          </ScrollableElement>
          <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
            Both horizontal and vertical scrolling with arrows
          </p>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Always Visible Scrollbars</h4>
          <ScrollableElement
            options={{ vertical: 'visible', horizontal: 'visible' }}
            style={{ height: '200px', width: '400px', border: '1px solid var(--vscode-panel-border)' }}
          >
            <div style={{ height: '400px', padding: '20px', backgroundColor: 'var(--vscode-editor-background)' }}>
              <h5 style={{ margin: '0 0 10px 0' }}>Always Visible</h5>
              <p>These scrollbars are always visible.</p>
              <p>They don&apos;t hide automatically.</p>
              <p>Perfect for cases where you want constant visibility.</p>
              <p>No need to hover to see the scrollbars.</p>
              <p>They remain visible at all times.</p>
              <p>This is useful for accessibility.</p>
              <p>Or when you want to show scroll state.</p>
              <p>Content continues below...</p>
              <p>More content to scroll through...</p>
              <p>Scrollbars stay visible!</p>
            </div>
          </ScrollableElement>
          <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
            Scrollbars are always visible regardless of mouse interaction
          </p>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Hidden Scrollbars</h4>
          <ScrollableElement
            options={{ vertical: 'hidden', horizontal: 'hidden' }}
            style={{ height: '200px', width: '400px', border: '1px solid var(--vscode-panel-border)' }}
          >
            <div style={{ height: '400px', padding: '20px', backgroundColor: 'var(--vscode-editor-background)' }}>
              <h5 style={{ margin: '0 0 10px 0' }}>No Scrollbars</h5>
              <p>This content has scrollbars completely hidden.</p>
              <p>You can still scroll with mouse wheel or touch.</p>
              <p>But no visual scrollbar indicators.</p>
              <p>Useful for clean interfaces.</p>
              <p>Or when you want minimal visual clutter.</p>
              <p>Content continues below...</p>
              <p>More content to scroll through...</p>
              <p>No scrollbars visible!</p>
            </div>
          </ScrollableElement>
          <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
            Scrollbars are completely hidden but scrolling still works
          </p>
        </div>
      </div>
  )
}

export default ScrollbarsTab
