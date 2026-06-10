import { installScenarioValueResolvers } from '../../../../shared/scenarioValueResolvers'
import { useRestormStore } from '../../store/restormStore'

/**
 * Registers the renderer-side scenario value resolvers so the inspector's
 * static preview renders an `environment` operand as `{ name, variables }` and a
 * `customList` operand as its substituted VALUE (e.g. `Rouge` → `FF0000`) —
 * mirroring the headless engine (which installs the same resolvers from the
 * loaded project) instead of the opaque `{{$id}}` template / the bare label.
 *
 * Side-effect on import (idempotent reassignment). Imported once by the scenario
 * editor. Reads the live collection store on every call, so it tracks env-folder
 * + custom-list edits without re-registering.
 */
installScenarioValueResolvers(() => useRestormStore.getState().collections)
