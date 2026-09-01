/**
 * The contract for a save that the user cancelled at the OS dialog.
 *
 * The main process returns `{ success: false, error: SAVE_CANCELLED }` when
 * the user dismisses the "Save as" dialog. That is a normal choice, not a
 * failure — the renderer must NOT log it as an error, or every cancel becomes
 * a crash-report event that drowns the real ones. The sentinel and its test
 * live here so the producer (main) and the consumer (renderer) share one
 * literal instead of two that can silently drift apart.
 */
export const SAVE_CANCELLED = 'Cancelled'

/** True when a save result is the user cancelling the save dialog. */
export function isSaveCancellation(
  result: { success?: boolean; error?: string } | null | undefined
): boolean {
  return result?.success === false && result.error === SAVE_CANCELLED
}
