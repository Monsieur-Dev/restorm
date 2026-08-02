declare module '@milkdown/react' {
  import type React from 'react'

  export const MilkdownProvider: React.FC<{
    children?: React.ReactNode
  }>

  export const Milkdown: React.FC

  export function useEditor(
    init: (root: HTMLElement) => void,
    deps?: unknown[]
  ): void
}

declare module '@milkdown/crepe' {
  /** Per-feature options passed through `CrepeConfig.featureConfigs`.
   * Only the features this app actually configures are modelled. */
  export interface CrepeFeatureConfig {
    placeholder?: {
      /** Empty-document hint. Crepe defaults it to an untranslatable
       * English string, so callers must supply a localized one. */
      text?: string
      mode?: 'doc' | 'block'
    }
  }

  export interface CrepeConfig {
    root: HTMLElement
    featureConfigs?: CrepeFeatureConfig
    [key: string]: unknown
  }

  export interface CrepeInstance {
    create?(): Promise<unknown>
    destroy?(): Promise<unknown>
  }

  export type CrepeConstructor = (new (config: CrepeConfig) => CrepeInstance) & {
    /** Feature-name constants, keyed the same as `CrepeFeatureConfig`. */
    Feature: { Placeholder: 'placeholder' }
  }

  export const Crepe: CrepeConstructor
}
