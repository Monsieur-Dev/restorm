# Window Management System

## Overview

The window management system provides automatic persistence and restoration of window state (size, position, fullscreen mode) across application sessions. This ensures users have a consistent experience with windows appearing exactly where they left them.

**Linear Issue**: [OYO-35](https://linear.app/oyo-fr/issue/OYO-35/window-management)

**Branch**: `yoanndiguet/oyo-35-window-management`

## Architecture

### Components

#### 1. StorageService (`src/main/services/StorageService.ts`)

A generic key-value storage service that persists data to a JSON file in the application's user data directory.

**Features:**
- Simple CRUD operations: `get()`, `set()`, `has()`, `delete()`
- Automatic file creation and directory management
- Error handling for file I/O operations
- Singleton pattern for application-wide access

**Storage Location:**
- Linux: `~/.config/gitable/config.json`
- Windows: `%APPDATA%/gitable/config.json`
- macOS: `~/Library/Application Support/gitable/config.json`

#### 2. WindowManager (`src/main/managers/WindowManager.ts`)

Manages window state persistence with safety checks to ensure windows remain visible and accessible.

**Features:**
- Load window state from storage with validation
- Save window state on move, resize, and fullscreen changes
- Safety checks to prevent windows from being positioned off-screen
- Automatic event listeners for state changes

**Safety Checks:**

1. **On Save:**
   - Prevents negative Y positions (forces to 0 minimum)

2. **On Load:**
   - Validates window dimensions are reasonable (min 400x300)
   - Ensures window is at least partially visible horizontally
   - Verifies title bar is visible (at least 40px from top visible)
   - Falls back to centered default position if checks fail

#### 3. MainWindow (`src/main/windows/MainWindow.ts`)

Concrete implementation for the main application window, integrating WindowManager with all existing window features.

**Features:**
- Uses WindowManager for state persistence
- Maintains all existing functionality (DevTools, menu bar, etc.)
- Window name: `"main"`
- Default size: 1200x800

### Data Structure

Window states are stored under the `windows` key in the storage:

```json
{
  "windows": {
    "main": {
      "width": 1200,
      "height": 800,
      "x": 100,
      "y": 50,
      "fullscreen": false
    }
  }
}
```

## Usage

### Creating a New Window with State Persistence

```typescript
import { MainWindow } from './windows/MainWindow'

const mainWindow = new MainWindow(isDevToolsEnabled)
const browserWindow = mainWindow.create()
```

### Extending for Additional Windows

To add state persistence to other windows:

```typescript
import { WindowManager } from './managers/WindowManager'

const windowManager = new WindowManager({
  name: 'settings',  // Unique name for this window
  defaultWidth: 800,
  defaultHeight: 600
})

const state = windowManager.loadWindowState()
const window = new BrowserWindow({
  width: state.width,
  height: state.height,
  x: state.x,
  y: state.y,
  // ... other options
})

windowManager.setWindow(window)

if (state.fullscreen) {
  window.setFullScreen(true)
}
```

## Technical Details

### Event Listeners

WindowManager automatically attaches the following event listeners:

- `moved`: Saves state when window is moved
- `resized`: Saves state when window is resized
- `enter-full-screen`: Saves state when entering fullscreen
- `leave-full-screen`: Saves state when exiting fullscreen
- `close`: Saves final state before closing

### Screen Bounds Validation

The system uses Electron's `screen.getPrimaryDisplay()` to get the current screen dimensions and validates that:

1. Window width and height are within screen bounds
2. At least part of the window is visible horizontally
3. The title bar (top 40px) is accessible for dragging
4. The window is not positioned below the screen

### Default Positioning

When no saved state exists or validation fails:
- Window is centered on the primary display
- Default dimensions are used (1200x800 for main window)
- Position is calculated based on screen work area (excludes taskbars)

## Testing

To test the window management system:

1. **First Launch:**
   - Application should open centered with default size
   - Move and resize the window
   - Close the application

2. **Subsequent Launches:**
   - Application should restore exact position and size
   - Test fullscreen mode preservation
   - Verify state persists across restarts

3. **Safety Checks:**
   - Manually edit `config.json` with invalid positions
   - Application should fall back to safe defaults
   - Window should always remain accessible

4. **Multi-Monitor:**
   - Position window on secondary monitor
   - Disconnect secondary monitor
   - Application should restore on primary display

## Files Modified

- `src/main/index.ts` - Refactored to use MainWindow class

## Files Created

- `src/main/services/StorageService.ts` - Generic storage service
- `src/main/managers/WindowManager.ts` - Window state manager
- `src/main/windows/MainWindow.ts` - Main window implementation
- `docs/window-management/README.md` - This documentation

## Future Enhancements

Potential improvements for future iterations:

1. **Multi-Monitor Support:**
   - Remember which display the window was on
   - Automatically adjust if display is no longer available

2. **Window States:**
   - Persist maximized state separately from fullscreen
   - Remember minimized state preference

3. **Per-Display Settings:**
   - Different positions for different screen configurations
   - Adapt to resolution changes

4. **Advanced Safety:**
   - Detect DPI changes and adjust accordingly
   - Handle screen rotation
   - Adapt to virtual desktop changes

## References

- [Electron BrowserWindow Documentation](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron Screen API](https://www.electronjs.org/docs/latest/api/screen)
- [Electron App User Data Path](https://www.electronjs.org/docs/latest/api/app#appgetpathname)

