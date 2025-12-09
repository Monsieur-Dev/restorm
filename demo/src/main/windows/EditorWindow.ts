import { join } from 'path'
import { logger } from 'electron-core-ui'
import { DemoWindow } from './DemoWindow'

/**
 * EditorWindow - Editor window displaying WorkbenchTab
 */
export class EditorWindow extends DemoWindow {
  private static readonly DEFAULT_WIDTH = 1200
  private static readonly DEFAULT_HEIGHT = 800
  private initialPosition: { x?: number; y?: number } | undefined

  constructor(file?: { title: string; content?: string; x?: number; y?: number }) {
    // Store initial position in local variable (before super() call)
    // Only include x/y if they are defined (for exactOptionalPropertyTypes)
    const initialPosition: { x?: number; y?: number } | undefined = 
      file && (file.x !== undefined || file.y !== undefined)
        ? {
            ...(file.x !== undefined && { x: file.x }),
            ...(file.y !== undefined && { y: file.y })
          }
        : undefined
    
    logger.info('📝 EditorWindow constructor started', { file, initialPosition })
    
    // Create configuration object using DemoWindow static helper
    const configuration = DemoWindow.createConfiguration({
      name: 'editor',
      defaultWidth: EditorWindow.DEFAULT_WIDTH,
      defaultHeight: EditorWindow.DEFAULT_HEIGHT,
      url: process.env['ELECTRON_RENDERER_URL'] ? `${process.env['ELECTRON_RENDERER_URL']}/editor.html` : undefined,
      file: join(__dirname, '../renderer/editor.html'),
      iconPath: join(__dirname, '../../assets/icons/icon')
    })
    
    logger.info(`📋 Configuration: ${JSON.stringify(configuration, null, 2)}`)
    logger.info('🔧 Calling super() with configuration...')
    super(configuration)
    logger.info('✅ EditorWindow constructor completed')
    
    // Store initial position after super() call
    this.initialPosition = initialPosition
    
    // If initial position is provided, set window position after creation
    if (this.initialPosition) {
      const window = this.getWindow()
      if (window && !window.isDestroyed()) {
        const bounds = window.getBounds()
        const newX = this.initialPosition.x !== undefined 
          ? this.initialPosition.x - 30
          : bounds.x
        const newY = this.initialPosition.y !== undefined
          ? this.initialPosition.y - 50 // Offset from cursor (roughly where title bar would be)
          : bounds.y
        
        logger.info('📍 Setting initial window position', {
          cursorX: this.initialPosition.x,
          cursorY: this.initialPosition.y,
          windowX: newX,
          windowY: newY,
          defaultWidth: EditorWindow.DEFAULT_WIDTH
        })
        
        window.setPosition(newX, newY)
      }
    }
  }
}

