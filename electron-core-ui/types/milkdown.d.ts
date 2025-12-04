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
  export interface CrepeConfig {
    root: HTMLElement
    [key: string]: unknown
  }

  export interface CrepeInstance {
    create?(): Promise<unknown>
    destroy?(): Promise<unknown>
  }

  export type CrepeConstructor = new (config: CrepeConfig) => CrepeInstance

  export const Crepe: CrepeConstructor
}


