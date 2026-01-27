import { dialog, type MessageBoxOptions, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { i18nService } from '../services/I18nService'
import { logger } from '../services/LoggerService'

type ButtonKey = string

export interface ConfirmationDialogConfig {
  /**
   * I18n keys for the buttons (ordered).
   * Example: ["file.unsavedChanges.save", "file.unsavedChanges.dontSave", "file.unsavedChanges.cancel"]
   */
  buttonKeys: readonly ButtonKey[]
  /**
   * I18n key of the button the user "clicked".
   * Must be one of buttonKeys.
   */
  choiceKey: ButtonKey
}

export type FileDialogKind = 'openFile' | 'openFolder' | 'saveFolder'

export interface OpenDialogMockConfig {
  kind: 'openFile' | 'openFolder'
  path: string
}

export interface SaveFileDialogMockConfig {
  kind: 'saveFile'
  path: string
}

export interface SaveFolderDialogMockConfig {
  kind: 'saveFolder'
  path: string
}

interface MessageBoxCallRecord {
  buttons: readonly string[]
  title: string | undefined
  message: string | undefined
  detail: string | undefined
}

interface OpenDialogCallRecord {
  properties: readonly string[]
  defaultPath: string | undefined
}

interface SaveDialogCallRecord {
  defaultPath: string | undefined
}

interface SystemModalsMockSnapshot {
  installed: boolean
  calls: {
    messageBox: number
    openDialog: number
    saveDialog: number
  }
  lastCall: {
    messageBox: MessageBoxCallRecord | undefined
    openDialog: OpenDialogCallRecord | undefined
    saveDialog: SaveDialogCallRecord | undefined
  }
  pending: {
    confirmation: ConfirmationDialogConfig | undefined
    openDialog: OpenDialogMockConfig | undefined
    saveFileDialog: SaveFileDialogMockConfig | undefined
    saveFolderDialog: SaveFolderDialogMockConfig | undefined
  }
}

let installed = false

let originalShowMessageBox: typeof dialog.showMessageBox | null = null
let originalShowOpenDialog: typeof dialog.showOpenDialog | null = null
let originalShowSaveDialog: typeof dialog.showSaveDialog | null = null

let pendingConfirmation: ConfirmationDialogConfig | null = null
let pendingOpenDialog: OpenDialogMockConfig | null = null
let pendingSaveFileDialog: SaveFileDialogMockConfig | null = null
let pendingSaveFolderDialog: SaveFolderDialogMockConfig | null = null

let messageBoxCalls = 0
let openDialogCalls = 0
let saveDialogCalls = 0

let lastMessageBoxCall: MessageBoxCallRecord | undefined
let lastOpenDialogCall: OpenDialogCallRecord | undefined
let lastSaveDialogCall: SaveDialogCallRecord | undefined

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function getLastArg(args: unknown[]): unknown {
  invariant(args.length > 0, 'No arguments provided')
  return args[args.length - 1]
}

function expectedDialogPropertyForKind(kind: FileDialogKind): 'openFile' | 'openDirectory' {
  switch (kind) {
    case 'openFile':
      return 'openFile'
    case 'openFolder':
    case 'saveFolder':
      return 'openDirectory'
  }
}

function validateButtonsWithI18n(buttonKeys: readonly string[], actualButtons: readonly string[]): void {
  const expected = buttonKeys.map((k) => i18nService.t(k))
  invariant(
    actualButtons.length === expected.length,
    `Unexpected buttons count. Expected ${expected.length}, got ${actualButtons.length}.`
  )

  for (let i = 0; i < expected.length; i++) {
    const expectedText = expected[i]
    const actualText = actualButtons[i]
    invariant(
      actualText === expectedText,
      `Unexpected button at index ${i}. Expected "${expectedText}", got "${actualText}".`
    )
  }
}

function choiceIndex(buttonKeys: readonly string[], choiceKey: string): number {
  const idx = buttonKeys.indexOf(choiceKey)
  invariant(idx !== -1, `choiceKey "${choiceKey}" must be one of buttonKeys.`)
  return idx
}

export function installSystemModalsMocking(): void {
  if (installed) return

  installed = true
  originalShowMessageBox ??= dialog.showMessageBox.bind(dialog)
  originalShowOpenDialog ??= dialog.showOpenDialog.bind(dialog)
  originalShowSaveDialog ??= dialog.showSaveDialog.bind(dialog)

  dialog.showMessageBox = ((...args: unknown[]) => {
    const options = getLastArg(args) as MessageBoxOptions

    messageBoxCalls++
    lastMessageBoxCall = {
      buttons: Array.isArray(options.buttons) ? options.buttons : [],
      title: options.title,
      message: options.message,
      detail: options.detail
    }

    const config = pendingConfirmation
    invariant(
      config,
      'Unexpected confirmation dialog: no mock configured. Configure it explicitly before triggering.'
    )

    try {
      const call = lastMessageBoxCall
      invariant(call, 'Internal error: missing message box call record')
      validateButtonsWithI18n(config.buttonKeys, call.buttons)
      const response = choiceIndex(config.buttonKeys, config.choiceKey)
      return Promise.resolve({ response, checkboxChecked: false })
    } finally {
      // One-shot: clear configuration so tests must set it explicitly each time.
      pendingConfirmation = null
    }
  }) as unknown as typeof dialog.showMessageBox

  dialog.showOpenDialog = ((...args: unknown[]) => {
    const options = getLastArg(args) as OpenDialogOptions

    openDialogCalls++
    lastOpenDialogCall = {
      properties: Array.isArray(options.properties) ? options.properties : [],
      defaultPath: options.defaultPath
    }

    const folderCfg = pendingSaveFolderDialog
    const cfg = pendingOpenDialog ?? (folderCfg ? { kind: 'openFolder' as const, path: folderCfg.path } : null)
    invariant(
      cfg,
      'Unexpected open dialog: no mock configured. Configure it explicitly before triggering.'
    )

    try {
      const expectedProp = expectedDialogPropertyForKind(folderCfg ? 'saveFolder' : cfg.kind)
      const call = lastOpenDialogCall
      invariant(call, 'Internal error: missing open dialog call record')
      invariant(
        call.properties.includes(expectedProp),
        `Unexpected open dialog kind. Expected "${expectedProp}" in properties, got [${call.properties.join(', ')}].`
      )
      return Promise.resolve({ canceled: false, filePaths: [cfg.path] })
    } finally {
      pendingOpenDialog = null
      pendingSaveFolderDialog = null
    }
  }) as unknown as typeof dialog.showOpenDialog

  dialog.showSaveDialog = ((...args: unknown[]) => {
    const options = getLastArg(args) as SaveDialogOptions

    saveDialogCalls++
    lastSaveDialogCall = {
      defaultPath: options.defaultPath
    }

    const cfg = pendingSaveFileDialog
    invariant(
      cfg,
      'Unexpected save dialog: no mock configured. Configure it explicitly before triggering.'
    )

    try {
      return Promise.resolve({ canceled: false, filePath: cfg.path })
    } finally {
      pendingSaveFileDialog = null
    }
  }) as unknown as typeof dialog.showSaveDialog

  logger.debug('[SystemModalsMock] Installed')
}

export function resetSystemModalsMockHistory(): void {
  messageBoxCalls = 0
  openDialogCalls = 0
  saveDialogCalls = 0
  lastMessageBoxCall = undefined
  lastOpenDialogCall = undefined
  lastSaveDialogCall = undefined
}

export function clearSystemModalsMockPending(): void {
  pendingConfirmation = null
  pendingOpenDialog = null
  pendingSaveFileDialog = null
  pendingSaveFolderDialog = null
}

export function getSystemModalsMockSnapshot(): SystemModalsMockSnapshot {
  return {
    installed,
    calls: {
      messageBox: messageBoxCalls,
      openDialog: openDialogCalls,
      saveDialog: saveDialogCalls
    },
    lastCall: {
      messageBox: lastMessageBoxCall,
      openDialog: lastOpenDialogCall,
      saveDialog: lastSaveDialogCall
    },
    pending: {
      confirmation: pendingConfirmation ?? undefined,
      openDialog: pendingOpenDialog ?? undefined,
      saveFileDialog: pendingSaveFileDialog ?? undefined,
      saveFolderDialog: pendingSaveFolderDialog ?? undefined
    }
  }
}

export function configureNextConfirmationDialog(config: ConfirmationDialogConfig): void {
  invariant(installed, 'System modals mocking is not installed. Call installSystemModalsMocking() first.')
  invariant(!pendingConfirmation, 'A confirmation dialog mock is already configured. Clear it or trigger it before configuring another.')
  invariant(config.buttonKeys.length > 0, 'buttonKeys must contain at least 1 key.')
  // Validate choiceKey now (fail fast)
  choiceIndex(config.buttonKeys, config.choiceKey)
  pendingConfirmation = config
}

export function configureNextOpenDialog(config: OpenDialogMockConfig): void {
  invariant(installed, 'System modals mocking is not installed. Call installSystemModalsMocking() first.')
  invariant(!pendingOpenDialog, 'An open dialog mock is already configured. Clear it or trigger it before configuring another.')
  pendingOpenDialog = config
}

export function configureNextSaveFileDialog(config: SaveFileDialogMockConfig): void {
  invariant(installed, 'System modals mocking is not installed. Call installSystemModalsMocking() first.')
  invariant(!pendingSaveFileDialog, 'A save file dialog mock is already configured. Clear it or trigger it before configuring another.')
  pendingSaveFileDialog = config
}

export function configureNextSaveFolderDialog(config: SaveFolderDialogMockConfig): void {
  invariant(installed, 'System modals mocking is not installed. Call installSystemModalsMocking() first.')
  invariant(!pendingSaveFolderDialog, 'A save folder dialog mock is already configured. Clear it or trigger it before configuring another.')
  pendingSaveFolderDialog = config
}
