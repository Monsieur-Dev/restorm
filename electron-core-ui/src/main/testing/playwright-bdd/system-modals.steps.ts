import type { ElectronAppLike } from '../systemModalsMockClient'
import {
  configureNextConfirmationDialogForE2E,
  configureNextOpenDialogForE2E,
  configureNextSaveFileDialogForE2E,
  configureNextSaveFolderDialogForE2E,
  getSystemModalsMockSnapshotForE2E,
  installSystemModalsMockingForE2E,
  resetSystemModalsMockHistoryForE2E
} from '../systemModalsMockClient'

export interface BddFns {
  Given: (pattern: string, fn: (fixtures: { electronApp: ElectronAppLike }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { electronApp: ElectronAppLike }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { electronApp: ElectronAppLike }, ...args: unknown[]) => unknown) => void
}

interface Snapshot {
  calls: { messageBox: number; openDialog: number; saveDialog: number }
  pending: { confirmation?: unknown; openDialog?: unknown; saveFileDialog?: unknown; saveFolderDialog?: unknown }
}

function asSnapshot(value: unknown): Snapshot {
  return value as Snapshot
}

async function waitForSnapshot(
  electronApp: ElectronAppLike,
  predicate: (snap: Snapshot) => boolean,
  timeoutMs = 5000,
  intervalMs = 100
): Promise<Snapshot> {
  const start = Date.now()
  let last: Snapshot = asSnapshot({ calls: { messageBox: 0, openDialog: 0, saveDialog: 0 }, pending: {} })

  while (Date.now() - start <= timeoutMs) {
    try {
      last = asSnapshot(await getSystemModalsMockSnapshotForE2E(electronApp))
      if (predicate(last)) {
        return last
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      // Electron can reload/navigate, temporarily destroying the evaluate context.
      if (!msg.includes('Execution context was destroyed')) {
        throw error
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))
  }

  return last
}

function parseKeysList(value: string): string[] {
  const keys = value
    .split(/[|,]/g)
    .map((k) => k.trim())
    .filter((k) => k.length > 0)

  if (keys.length === 0) {
    throw new Error('Expected at least 1 button key')
  }

  return keys
}

export function defineSystemModalsBddSteps({ Given, When, Then }: BddFns): void {
  Given('system modals mocking is installed', async ({ electronApp }) => {
    await installSystemModalsMockingForE2E(electronApp)
    await resetSystemModalsMockHistoryForE2E(electronApp)
  })

  Given('I configure the confirmation dialog buttons {string} and choose {string}', async ({ electronApp }, keys: unknown, choice: unknown) => {
    if (typeof keys !== 'string' || typeof choice !== 'string') {
      throw new Error('Invalid parameters for confirmation dialog configuration')
    }

    const buttonKeys = parseKeysList(keys)
    await configureNextConfirmationDialogForE2E(electronApp, {
      buttonKeys,
      choiceKey: choice
    })
  })

  Then('a confirmation dialog should have been shown', async ({ electronApp }) => {
    const snap = await waitForSnapshot(
      electronApp,
      (s) => s.calls.messageBox > 0 && !s.pending.confirmation,
      5000
    )
    if (snap.calls.messageBox <= 0) {
      throw new Error('Expected a confirmation dialog (MessageBox) to be shown, but none was shown.')
    }
    if (snap.pending.confirmation) {
      throw new Error('Expected confirmation dialog mock configuration to be cleared after use, but it is still pending.')
    }
  })

  Then('no confirmation dialog should have been shown', async ({ electronApp }) => {
    const snap = asSnapshot(await getSystemModalsMockSnapshotForE2E(electronApp))
    if (snap.calls.messageBox !== 0) {
      throw new Error(`Expected no confirmation dialog (MessageBox), but got ${snap.calls.messageBox}.`)
    }
  })

  Then('no system modal should have been shown', async ({ electronApp }) => {
    const snap = asSnapshot(await getSystemModalsMockSnapshotForE2E(electronApp))
    const total = snap.calls.messageBox + snap.calls.openDialog + snap.calls.saveDialog
    if (total !== 0) {
      throw new Error(
        `Expected no system modal, but got messageBox=${snap.calls.messageBox}, openDialog=${snap.calls.openDialog}, saveDialog=${snap.calls.saveDialog}.`
      )
    }
  })

  Given('I configure the open file dialog to return path {string}', async ({ electronApp }, path: unknown) => {
    if (typeof path !== 'string') throw new Error('Invalid path')
    await configureNextOpenDialogForE2E(electronApp, { kind: 'openFile', path })
  })

  Given('I configure the open folder dialog to return path {string}', async ({ electronApp }, path: unknown) => {
    if (typeof path !== 'string') throw new Error('Invalid path')
    await configureNextOpenDialogForE2E(electronApp, { kind: 'openFolder', path })
  })

  Given('I configure the save file dialog to return path {string}', async ({ electronApp }, path: unknown) => {
    if (typeof path !== 'string') throw new Error('Invalid path')
    await configureNextSaveFileDialogForE2E(electronApp, { kind: 'saveFile', path })
  })

  Given('I configure the save folder dialog to return path {string}', async ({ electronApp }, path: unknown) => {
    if (typeof path !== 'string') throw new Error('Invalid path')
    await configureNextSaveFolderDialogForE2E(electronApp, { kind: 'saveFolder', path })
  })

  Then('an open dialog should have been shown', async ({ electronApp }) => {
    const snap = await waitForSnapshot(
      electronApp,
      (s) => s.calls.openDialog > 0 && !s.pending.openDialog && !s.pending.saveFolderDialog,
      5000
    )
    if (snap.calls.openDialog <= 0) {
      throw new Error('Expected an open dialog to be shown, but none was shown.')
    }
    if (snap.pending.openDialog || snap.pending.saveFolderDialog) {
      throw new Error('Expected open dialog mock configuration to be cleared after use, but it is still pending.')
    }
  })

  Then('a save dialog should have been shown', async ({ electronApp }) => {
    const snap = await waitForSnapshot(
      electronApp,
      (s) => s.calls.saveDialog > 0 && !s.pending.saveFileDialog,
      5000
    )
    if (snap.calls.saveDialog <= 0) {
      throw new Error('Expected a save dialog to be shown, but none was shown.')
    }
    if (snap.pending.saveFileDialog) {
      throw new Error('Expected save dialog mock configuration to be cleared after use, but it is still pending.')
    }
  })

  When('I reset system modals mock history', async ({ electronApp }) => {
    await resetSystemModalsMockHistoryForE2E(electronApp)
  })
}
