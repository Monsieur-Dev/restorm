import type { ValueSourceDescriptor } from './ValueSource'

export class ValueSourceRegistry {
  private readonly descriptors = new Map<string, ValueSourceDescriptor>()

  register(d: ValueSourceDescriptor): void {
    this.descriptors.set(d.id, d)
  }

  get(id: string): ValueSourceDescriptor | undefined {
    return this.descriptors.get(id)
  }

  list(): ValueSourceDescriptor[] {
    return [...this.descriptors.values()]
  }
}

export const valueSourceRegistry = new ValueSourceRegistry()
