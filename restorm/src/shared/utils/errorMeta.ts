/**
 * Normalise a caught value into structured log metadata.
 *
 * The logger's second parameter is a metadata object (`Record<string,
 * unknown>`), not a message continuation. Handing it a raw `Error` looks
 * right but silently loses the cause: an `Error`'s `message` and `stack` are
 * NON-ENUMERABLE, so once the metadata is serialised for a transport or a
 * crash reporter the object collapses to `{}` — the report reads "No error
 * message". Routing the cause through this helper puts the message and stack
 * onto plain, enumerable keys so they survive serialisation.
 */
export function errorMeta(error: unknown): { error: string; stack?: string } {
  if (error instanceof Error) {
    return { error: error.message, stack: error.stack }
  }
  return { error: String(error) }
}
