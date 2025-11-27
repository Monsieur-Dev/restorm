import React from 'react'
import { Button, ButtonWithDescription, ButtonWithDropdown, ButtonWithIcon, logger } from 'electron-core-ui/renderer'

const ButtonsTab: React.FC = () => {
  return (
    <div style={{ display: 'grid', gap: '20px', maxWidth: '800px', padding: '20px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>VSCode Button Components</h3>
        
        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Basic Buttons (New API with children)</h4>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button onClick={() => { logger.info('Primary button clicked') }}>
              Primary Button
            </Button>
            <Button
              secondary
              onClick={() => { logger.info('Secondary button clicked') }}
            >
              Secondary Button
            </Button>
            <Button disabled={true}>
              Disabled Button
            </Button>
            <Button disabled>
              Disabled Short
            </Button>
          </div>
        </div>


        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Buttons with Icons (New API)</h4>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              icon="save"
              onClick={() => { logger.info('Save clicked') }}
            >
              Save
            </Button>
            <Button
              secondary
              icon="close"
              onClick={() => { logger.info('Cancel clicked') }}
            >
              Cancel
            </Button>
            <Button onClick={() => { logger.info('Start clicked') }}>
              $(play) Start
            </Button>
          </div>
        </div>


        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Button with Description (New API)</h4>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <ButtonWithDescription
              description="Deploy to production environment"
              icon="rocket"
              onClick={() => { logger.info('Deploy clicked') }}
            >
              Deploy
            </ButtonWithDescription>
            <ButtonWithDescription
              options={{ secondary: true }}
              description="Create system backup"
              icon="database"
              onClick={() => { logger.info('Backup clicked') }}
            >
              Backup
            </ButtonWithDescription>
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Button with Dropdown</h4>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <ButtonWithDropdown
              options={{
                disabled: false,
                actions: [
                  { label: 'New File', onClick: () => { logger.info('New File') } },
                  { label: 'New Folder', onClick: () => { logger.info('New Folder') } },
                  { label: 'Import', onClick: () => { logger.info('Import') } }
                ]
              }}
              label="New"
              icon="add"
              onClick={() => { logger.info('New clicked') }}
            />
            <ButtonWithDropdown
              options={{
                secondary: false,
                actions: [
                  { label: 'Save', onClick: () => { logger.info('Save') } },
                  { label: 'Save As...', onClick: () => { logger.info('Save As') } },
                  { label: 'Export', onClick: () => { logger.info('Export') } }
                ]
              }}
              label="File"
              onClick={() => { logger.info('File clicked') }}
            />
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Button with Icon Component</h4>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <ButtonWithIcon
              options={{ disabled: false }}
              icon="play"
              label="Start Process"
              onClick={() => { logger.info('Start Process clicked') }}
            />
            <ButtonWithIcon
              options={{ secondary: true }}
              icon="stop"
              label="Stop Process"
              onClick={() => { logger.info('Stop Process clicked') }}
            />
            <Button onClick={() => { logger.info('Inline icon clicked') }}>
              $(play) Start with Inline Icon
            </Button>
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Short Label Support with Tooltip</h4>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              options={{ 
                disabled: false,
                supportShortLabel: true
              }}
              onClick={() => { logger.info('Short label clicked') }}
            >
              Very Long Button Label That Should Be Shortened
            </Button>
            <Button
              options={{ 
                disabled: false,
                supportShortLabel: false
              }}
              onClick={() => { logger.info('Long label clicked') }}
            >
              Another Very Long Button Label That Will Show Tooltip When Truncated
            </Button>
            <Button
              options={{ 
                disabled: false
              }}
              onClick={() => { logger.info('Short button clicked') }}
            >
              Short
            </Button>
          </div>
        </div>
      </div>
  )
}

export default ButtonsTab
