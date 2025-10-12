import { SettingsService, SettingChangeListener } from '../services/SettingsService'

/**
 * Base class for all setting handlers
 * This class provides a pattern for subscribing to setting changes
 */
export abstract class Setting<T = unknown> {
  protected settingKey: string
  protected unsubscribe: (() => void) | null = null

  constructor(
    settingKey: string,
    protected settingsService: SettingsService
  ) {
    this.settingKey = settingKey
  }

  /**
   * Initialize the setting handler
   * Subscribes to changes and applies initial value
   */
  initialize(): void {
    // Get initial value and apply it
    const initialValue = this.settingsService.getSetting<T>(this.settingKey)
    if (initialValue !== undefined) {
      this.apply(initialValue, initialValue)
    }

    // Subscribe to future changes
    const listener: SettingChangeListener = (key, newValue, oldValue) => {
      this.onChange(newValue as T, oldValue as T)
    }

    this.unsubscribe = this.settingsService.subscribe(this.settingKey, listener)
  }

  /**
   * Cleanup the setting handler
   * Unsubscribes from changes
   */
  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
  }

  /**
   * Called when the setting value changes
   * @param newValue The new value
   * @param oldValue The previous value
   */
  protected onChange(newValue: T, oldValue: T): void {
    console.log(`Setting '${this.settingKey}' changed from`, oldValue, 'to', newValue)
    this.apply(newValue, oldValue)
  }

  /**
   * Apply the setting value
   * This method must be implemented by subclasses to define how the setting affects the application
   * @param value The value to apply
   * @param previousValue The previous value (useful for rollback on error)
   */
  protected abstract apply(value: T, previousValue: T): void

  /**
   * Get the current value of the setting
   */
  getValue(): T | undefined {
    return this.settingsService.getSetting<T>(this.settingKey)
  }
}

