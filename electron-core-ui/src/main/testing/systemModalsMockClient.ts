import type {
  ConfirmationDialogConfig,
  OpenDialogMockConfig,
  SaveFileDialogMockConfig,
  SaveFolderDialogMockConfig
} from './systemModalsMockMain'

import coreEnTranslation from '../../renderer/locales/en/translation.json'
import coreFrTranslation from '../../renderer/locales/fr/translation.json'
import { isAbsolute, resolve } from 'path'

type ElectronAppEvaluate = <R>(pageFunction: (...args: unknown[]) => R | Promise<R>, ...args: unknown[]) => Promise<R>

export interface ElectronAppLike {
  evaluate: ElectronAppEvaluate
}

function getValue(keyPath: string, tree: Record<string, unknown>): string | undefined {
  const parts = keyPath.split('.')
  let current: unknown = tree
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : undefined
}

function translate(
  key: string,
  params: Record<string, string | number> | undefined,
  language: 'en' | 'fr'
): string {
  const tree = (language === 'fr' ? coreFrTranslation : coreEnTranslation) as unknown as Record<string, unknown>
  let value = getValue(key, tree)
  value ??= getValue(key, coreEnTranslation as unknown as Record<string, unknown>)
  if (!value) return key

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
    }
  }
  return value
}

function computeButtons(config: ConfirmationDialogConfig): { buttons: string[]; response: number } {
  // Default to English for tests unless your fixture forces another language.
  const language: 'en' | 'fr' = 'en'
  const buttons = config.buttonKeys.map((k) => translate(k, undefined, language))
  const response = config.buttonKeys.indexOf(config.choiceKey)
  if (response < 0) {
    throw new Error(`choiceKey "${config.choiceKey}" must be one of buttonKeys`)
  }
  return { buttons, response }
}

interface Snapshot {
  calls: { messageBox: number; openDialog: number; saveDialog: number }
  pending: {
    confirmation: unknown
    openDialog: unknown
    saveFileDialog: unknown
    saveFolderDialog: unknown
  }
}

async function ensureInstalled(electronApp: ElectronAppLike): Promise<void> {
  await electronApp.evaluate((electron: unknown) => {
    interface DialogLike {
      showMessageBox: (...args: unknown[]) => unknown
      showOpenDialog: (...args: unknown[]) => unknown
      showSaveDialog: (...args: unknown[]) => unknown
    }
    interface ElectronLike {
      dialog?: unknown
    }

    const electronLike = electron as ElectronLike
    const dialog = electronLike.dialog as DialogLike | undefined
    if (
      !dialog ||
      typeof dialog.showMessageBox !== 'function' ||
      typeof dialog.showOpenDialog !== 'function' ||
      typeof dialog.showSaveDialog !== 'function'
    ) {
      throw new Error('Electron dialog API is not available in this context')
    }

    const g = globalThis as unknown as { __ecuiSystemModalsMock?: unknown }

    interface State {
      installed: boolean
      calls: { messageBox: number; openDialog: number; saveDialog: number }
      pending: {
        confirmation: { buttons: string[]; response: number } | undefined
        openDialog: { kind: 'openFile' | 'openFolder'; path: string } | undefined
        saveFileDialog: { path: string } | undefined
        saveFolderDialog: { path: string } | undefined
      }
      lastCall?: { buttons?: unknown; properties?: unknown }
      original?: {
        showMessageBox: DialogLike['showMessageBox']
        showOpenDialog: DialogLike['showOpenDialog']
        showSaveDialog: DialogLike['showSaveDialog']
      }
    }

    const state = g.__ecuiSystemModalsMock as State | undefined
    if (state?.installed) return

    const newState: State = {
      installed: true,
      calls: { messageBox: 0, openDialog: 0, saveDialog: 0 },
      pending: {
        confirmation: undefined,
        openDialog: undefined,
        saveFileDialog: undefined,
        saveFolderDialog: undefined
      },
      original: {
        showMessageBox: dialog.showMessageBox,
        showOpenDialog: dialog.showOpenDialog,
        showSaveDialog: dialog.showSaveDialog
      }
    }
    g.__ecuiSystemModalsMock = newState

    function lastArg(args: unknown[]): unknown {
      return args[args.length - 1]
    }

    dialog.showMessageBox = ((...args: unknown[]) => {
      const s = (g.__ecuiSystemModalsMock as State | undefined) ?? newState
      s.calls.messageBox++
      const options = lastArg(args) as { buttons?: unknown }
      const actualButtons = Array.isArray(options.buttons) ? (options.buttons as string[]) : []
      const cfg = s.pending.confirmation
      if (!cfg) {
        throw new Error('Unexpected confirmation dialog: no mock configured. Configure it explicitly before triggering.')
      }
      try {
        if (actualButtons.length !== cfg.buttons.length) {
          throw new Error(`Unexpected buttons count. Expected ${cfg.buttons.length}, got ${actualButtons.length}.`)
        }
        for (let i = 0; i < cfg.buttons.length; i++) {
          if (actualButtons[i] !== cfg.buttons[i]) {
            throw new Error(`Unexpected button at index ${i}. Expected "${cfg.buttons[i]}", got "${actualButtons[i]}".`)
          }
        }
        return Promise.resolve({ response: cfg.response, checkboxChecked: false })
      } finally {
        s.pending.confirmation = undefined
      }
    }) as unknown as DialogLike['showMessageBox']

    dialog.showOpenDialog = ((...args: unknown[]) => {
      const s = (g.__ecuiSystemModalsMock as State | undefined) ?? newState
      s.calls.openDialog++
      const options = lastArg(args) as { properties?: unknown }
      const props = Array.isArray(options.properties) ? (options.properties as string[]) : []

      const cfg =
        s.pending.openDialog ??
        (s.pending.saveFolderDialog ? { kind: 'openFolder' as const, path: s.pending.saveFolderDialog.path } : undefined)
      if (!cfg) {
        throw new Error('Unexpected open dialog: no mock configured. Configure it explicitly before triggering.')
      }

      try {
        const expected = cfg.kind === 'openFile' ? 'openFile' : 'openDirectory'
        if (!props.includes(expected)) {
          throw new Error(`Unexpected open dialog kind. Expected "${expected}" in properties, got [${props.join(', ')}].`)
        }
        return Promise.resolve({ canceled: false, filePaths: [cfg.path] })
      } finally {
        s.pending.openDialog = undefined
        s.pending.saveFolderDialog = undefined
      }
    }) as unknown as DialogLike['showOpenDialog']

    dialog.showSaveDialog = ((..._args: unknown[]) => {
      const s = (g.__ecuiSystemModalsMock as State | undefined) ?? newState
      s.calls.saveDialog++
      const cfg = s.pending.saveFileDialog
      if (!cfg) {
        throw new Error('Unexpected save dialog: no mock configured. Configure it explicitly before triggering.')
      }
      try {
        return Promise.resolve({ canceled: false, filePath: cfg.path })
      } finally {
        s.pending.saveFileDialog = undefined
      }
    }) as unknown as DialogLike['showSaveDialog']
  })
}

export async function installSystemModalsMockingForE2E(electronApp: ElectronAppLike): Promise<void> {
  await ensureInstalled(electronApp)
}

export async function resetSystemModalsMockHistoryForE2E(electronApp: ElectronAppLike): Promise<void> {
  await ensureInstalled(electronApp)
  await electronApp.evaluate(() => {
    const g = globalThis as unknown as { __ecuiSystemModalsMock?: unknown }
    const state = g.__ecuiSystemModalsMock as Snapshot | undefined
    if (!state) return
    state.calls.messageBox = 0
    state.calls.openDialog = 0
    state.calls.saveDialog = 0
  })
}

export async function clearSystemModalsMockPendingForE2E(electronApp: ElectronAppLike): Promise<void> {
  await ensureInstalled(electronApp)
  await electronApp.evaluate(() => {
    const g = globalThis as unknown as { __ecuiSystemModalsMock?: unknown }
    const state = g.__ecuiSystemModalsMock as Snapshot | undefined
    if (!state) return
    state.pending.confirmation = undefined
    state.pending.openDialog = undefined
    state.pending.saveFileDialog = undefined
    state.pending.saveFolderDialog = undefined
  })
}

export async function configureNextConfirmationDialogForE2E(
  electronApp: ElectronAppLike,
  config: ConfirmationDialogConfig
): Promise<void> {
  await ensureInstalled(electronApp)
  const computed = computeButtons(config)
  await electronApp.evaluate((_electron: unknown, payload: unknown) => {
    const g = globalThis as unknown as { __ecuiSystemModalsMock?: unknown }
    const state = g.__ecuiSystemModalsMock as Snapshot | undefined
    if (!state) throw new Error('System modals mocking is not installed')
    const { buttons, response } = payload as { buttons: string[]; response: number }
    state.pending.confirmation = { buttons, response }
  }, computed)
}

export async function configureNextOpenDialogForE2E(
  electronApp: ElectronAppLike,
  config: OpenDialogMockConfig
): Promise<void> {
  const normalized: OpenDialogMockConfig = {
    ...config,
    path: isAbsolute(config.path) ? config.path : resolve(process.cwd(), config.path)
  }
  await ensureInstalled(electronApp)
  await electronApp.evaluate((_electron: unknown, payload: unknown) => {
    const g = globalThis as unknown as { __ecuiSystemModalsMock?: unknown }
    const state = g.__ecuiSystemModalsMock as Snapshot | undefined
    if (!state) throw new Error('System modals mocking is not installed')
    state.pending.openDialog = payload
  }, normalized)
}

export async function configureNextSaveFileDialogForE2E(
  electronApp: ElectronAppLike,
  config: SaveFileDialogMockConfig
): Promise<void> {
  const normalized: SaveFileDialogMockConfig = {
    ...config,
    path: isAbsolute(config.path) ? config.path : resolve(process.cwd(), config.path)
  }
  await ensureInstalled(electronApp)
  await electronApp.evaluate((_electron: unknown, payload: unknown) => {
    const g = globalThis as unknown as { __ecuiSystemModalsMock?: unknown }
    const state = g.__ecuiSystemModalsMock as Snapshot | undefined
    if (!state) throw new Error('System modals mocking is not installed')
    state.pending.saveFileDialog = payload
  }, normalized)
}

export async function configureNextSaveFolderDialogForE2E(
  electronApp: ElectronAppLike,
  config: SaveFolderDialogMockConfig
): Promise<void> {
  const normalized: SaveFolderDialogMockConfig = {
    ...config,
    path: isAbsolute(config.path) ? config.path : resolve(process.cwd(), config.path)
  }
  await ensureInstalled(electronApp)
  await electronApp.evaluate((_electron: unknown, payload: unknown) => {
    const g = globalThis as unknown as { __ecuiSystemModalsMock?: unknown }
    const state = g.__ecuiSystemModalsMock as Snapshot | undefined
    if (!state) throw new Error('System modals mocking is not installed')
    state.pending.saveFolderDialog = payload
  }, normalized)
}

export async function getSystemModalsMockSnapshotForE2E(electronApp: ElectronAppLike): Promise<unknown> {
  await ensureInstalled(electronApp)
  return await electronApp.evaluate(() => {
    const g = globalThis as unknown as { __ecuiSystemModalsMock?: unknown }
    return g.__ecuiSystemModalsMock
  })
}
