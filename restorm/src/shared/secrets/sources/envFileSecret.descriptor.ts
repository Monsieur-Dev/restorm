import type { ValueSourceDescriptor } from '../ValueSource'

/**
 * Secret backed by the sibling `restorm.env` file. The plaintext lives only
 * in that file (and in memory as `SecretValue.resolved`); the document tree
 * persists nothing but `{ type: 'secret', source: 'envFileSecret', params }`.
 *
 * `params`:
 *   - `key`        hierarchical entry id inside `restorm.env`
 *                  (`{collection}/{path}/{scope}/{field}`), recomputed from the
 *                  value's position in the tree on every save.
 *   - `folderPath` absolute path of the project folder that owns `restorm.env`,
 *                  so the resolver can read / write it without an ambient scope.
 *
 * Both params are derived positionally at save / load time rather than typed by
 * the user, so the descriptor exposes no `paramSchema`; the in-place editing
 * surface is provided by the named `configComponent`.
 */
export const envFileSecretDescriptor: ValueSourceDescriptor = {
  id: 'envFileSecret',
  labelKey: 'secrets.source.envFileSecret',
  icon: 'lock',
  canWrite: true,
  isObject: false,
  configComponent: 'envFileSecret'
}
