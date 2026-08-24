import { describe, it, expect } from 'vitest'
import { setTemplateScopeVariables } from '../../src/renderer/src/components/Design/designMutations'
import type { ApiDesign, DesignCodegenTemplate } from '../../src/shared/types/apiDesign'

const mkDesign = (templates: DesignCodegenTemplate[]): ApiDesign =>
  ({ id: 'd', info: { title: 'D' }, models: [], enums: [], routeGroups: [], codegen: { templates } }) as unknown as ApiDesign

const officialTemplate = (id: string, variables?: DesignCodegenTemplate['variables']): DesignCodegenTemplate =>
  ({ id, source: { kind: 'official', id: `src-${id}` }, ...(variables !== undefined ? { variables } : {}) })

describe('setTemplateScopeVariables', () => {
  it('sets one scope, preserving the template’s other scopes and other templates', () => {
    const design = mkDesign([
      officialTemplate('t1', { project: { region: 'eu' } }),
      officialTemplate('t2')
    ])
    setTemplateScopeVariables(design, 't1', 'route', { useCache: "{{eq route.method 'GET'}}" })
    const t1 = design.codegen?.templates?.find((t) => t.id === 't1')
    expect(t1?.variables?.project).toEqual({ region: 'eu' })
    expect(t1?.variables?.route).toEqual({ useCache: "{{eq route.method 'GET'}}" })
    expect(design.codegen?.templates?.find((t) => t.id === 't2')?.variables).toBeUndefined()
  })

  it('prunes an emptied scope, and drops `variables` entirely when nothing remains', () => {
    const design = mkDesign([officialTemplate('t1', { route: { a: '1' } })])
    setTemplateScopeVariables(design, 't1', 'route', {})
    expect(design.codegen?.templates?.[0]?.variables).toBeUndefined()
  })

  it('keeps the surviving scope when another is emptied', () => {
    const design = mkDesign([officialTemplate('t1', { project: { a: '1' }, route: { b: '2' } })])
    setTemplateScopeVariables(design, 't1', 'route', {})
    expect(design.codegen?.templates?.[0]?.variables).toEqual({ project: { a: '1' } })
  })
})
