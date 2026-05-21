import { createContext, useContext } from 'react'
import type { Environment, FolderItem } from '../../../../shared/types/collections'

/** Resolve a tree item by id to its live object (or null if gone). */
export type ResolveBoundItem = (itemId: string) => FolderItem | null

/**
 * Lets a scenario node box look up the live request/scenario it is bound to,
 * so a rename/update in the tree follows into the node. The provider value is
 * recreated whenever the tree changes, which re-renders the consuming boxes.
 */
export const ScenarioBoundResolverContext = createContext<ResolveBoundItem | null>(null)

export function useScenarioBoundResolver(): ResolveBoundItem | null {
  return useContext(ScenarioBoundResolverContext)
}

/** A request's environment picture: the envs it can run under + the default. */
export interface RequestEnvInfo {
  environments: Environment[]
  /** The env currently selected for the request (the node's default). */
  selectedEnvId: string | null
}

/** Resolve a request's environments + its default selection (or null when
 * the request has no ancestor environment folder). */
export type ResolveRequestEnv = (requestId: string) => RequestEnvInfo | null

export const ScenarioRequestEnvContext = createContext<ResolveRequestEnv | null>(null)

export function useScenarioRequestEnv(): ResolveRequestEnv | null {
  return useContext(ScenarioRequestEnvContext)
}
