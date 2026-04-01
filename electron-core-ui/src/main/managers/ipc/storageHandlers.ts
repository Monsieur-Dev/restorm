import { validatedHandle } from '../../ipc/validate'
import { storageGetArgs, storageSetArgs, storageDeleteArgs } from '../../ipc/schemas'
import { getStorageService } from '../../services'

export function registerStorageHandlers(): void {
  validatedHandle('storage:get', storageGetArgs, (_event, [key]) => {
    const storage = getStorageService()
    return storage.get(key)
  })

  validatedHandle('storage:set', storageSetArgs, (_event, [key, value]) => {
    const storage = getStorageService()
    storage.set(key, value)
    return true
  })

  validatedHandle('storage:delete', storageDeleteArgs, (_event, [key]) => {
    const storage = getStorageService()
    storage.delete(key)
    return true
  })
}
