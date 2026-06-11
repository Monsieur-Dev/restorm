import type { ValueSourceDescriptor } from '../ValueSource'

export const envVarDescriptor: ValueSourceDescriptor = {
  id: 'envVar',
  labelKey: 'secrets.source.envVar',
  canWrite: false,
  isObject: false,
  paramSchema: [
    {
      key: 'name',
      labelKey: 'secrets.param.envVarName',
      kind: 'text',
      required: true,
      placeholderKey: 'secrets.param.envVarNamePlaceholder'
    }
  ]
}
