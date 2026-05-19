// Re-export from the shared location so renderer + main can use the
// same implementation. See `restorm/src/shared/utils/cloneForEventBus.ts`
// for the full rationale.
export { cloneForEventBus } from '../../../shared/utils/cloneForEventBus'
