import type { ValueSourceResolver, ResolveCtx } from '../../../../shared/secrets/ValueSource'

export const envVarResolver: ValueSourceResolver = {
  id: 'envVar',

  read(params: Record<string, unknown>, _ctx: ResolveCtx): Promise<string> {
    const name = typeof params.name === 'string' ? params.name : ''
    if (name === '') {
      return Promise.reject(new Error('env var name is empty'))
    }
    const value = process.env[name]
    if (value === undefined) {
      return Promise.reject(new Error(`environment variable ${name} is not set`))
    }
    return Promise.resolve(value)
  }
}
