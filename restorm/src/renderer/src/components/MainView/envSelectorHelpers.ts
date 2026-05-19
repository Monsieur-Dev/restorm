import type { Environment } from '../../../../shared/types/collections'

/** Default "orange" used as a fallback for envs without a configured
 * `color` — matches the in-tab Send button + the color swatch in
 * `EnvironmentFolderView`. Lets each row in the popover always have
 * *some* tint even before the user has set one. */
export const DEFAULT_ENV_COLOR = '#c75000'

export interface FlatEnvRow {
	env: Environment
	depth: number
}

/** Flatten the env tree depth-first so the popover can render every
 * node as a single row (no collapse/expand needed). Indentation is
 * applied by the renderer via `depth * 24 px` per row. */
export function flattenEnvironments(environments: Environment[], depth = 0, out: FlatEnvRow[] = []): FlatEnvRow[] {
	for (const env of environments) {
		out.push({ env, depth })
		if (env.subEnvironments && env.subEnvironments.length > 0) {
			flattenEnvironments(env.subEnvironments, depth + 1, out)
		}
	}
	return out
}
