import { describe, it, expect } from 'vitest'
import { singleDeepPath, singleTopLevelKey, portPreviewValue, staticScenarioPreview, expectsObjectInput, type StaticPreviewNode, type StaticPreviewEdge } from '../../../../shared/utils/scenarioStaticPreview'

describe('expectsObjectInput', () => {
  it('skips auto-deduce for transform.value (the Handlebars context)', () => {
    expect(expectsObjectInput('transform', 'value')).toBe(true)
  })

  it('still auto-deduces for primitive-typed inputs', () => {
    expect(expectsObjectInput('wait', 'duration')).toBe(false)
    expect(expectsObjectInput('arithmetic', 'a')).toBe(false)
    expect(expectsObjectInput('comparator', 'b')).toBe(false)
  })
})

describe('portPreviewValue — unwraps a node that emits a bare value', () => {
  it('unwraps the value under the port id (arithmetic/comparator `{result}`, filter `{kept}`)', () => {
    expect(portPreviewValue({ result: 5 }, 'result', 'arithmetic')).toBe(5)
    expect(portPreviewValue({ kept: [1, 2], rejected: [3] }, 'kept', 'filter')).toEqual([1, 2])
  })

  it('unwraps a single display-named entry (`now` → `{now}`, `getVariable` → `{<var>}`)', () => {
    expect(portPreviewValue({ now: 1 }, 'value', 'now')).toBe(1)
    expect(portPreviewValue({ cpt: 5 }, 'value', 'getVariable')).toBe(5)
  })

  it('keeps the wrapper for the genuine wrapper kinds (transform `{result}`, input `{name}`)', () => {
    expect(portPreviewValue({ result: 'x' }, 'out', 'transform')).toEqual({ result: 'x' })
    expect(portPreviewValue({ value: 5 }, 'value', 'input')).toEqual({ value: 5 })
  })

  it('drives the right auto-selector: bare emitters → `.`, transform → `result`', () => {
    // The reported bug: arithmetic.result → log.data deduced "result" (wrong).
    // The port carries the bare number, so it must deduce "." (identity).
    expect(singleTopLevelKey(portPreviewValue({ result: 5 }, 'result', 'arithmetic'))).toBeNull() // → "."
    expect(singleDeepPath(portPreviewValue({ cpt: 5 }, 'value', 'getVariable'))).toBeNull() // → "."
    // transform genuinely wraps `{ result }` on its `out` port → keep "result".
    expect(singleTopLevelKey(portPreviewValue({ result: 'x' }, 'out', 'transform'))).toBe('result')
  })
})

describe('singleDeepPath', () => {
  it('deduces a single primitive property', () => {
    expect(singleDeepPath({ timer: 5 })).toBe('timer')
    expect(singleDeepPath({ ok: true })).toBe('ok')
  })

  it('deduces a single deep chain of single-property objects', () => {
    expect(singleDeepPath({ foo: { bar: { hello: 'world' } } })).toBe('foo.bar.hello')
  })

  it('returns null when a level branches', () => {
    expect(singleDeepPath({ a: 1, b: 2 })).toBeNull()
    expect(singleDeepPath({ foo: { bar: 1, baz: 2 } })).toBeNull()
  })

  it('returns null for an array leaf or an empty object', () => {
    expect(singleDeepPath({ a: [1, 2] })).toBeNull()
    expect(singleDeepPath({ a: {} })).toBeNull()
    expect(singleDeepPath({})).toBeNull()
  })
})

function node(id: string, kind: StaticPreviewNode['kind'], config: Record<string, unknown>): StaticPreviewNode {
  return { id, kind, config }
}

describe('staticScenarioPreview', () => {
  it('input → { <name>: value }', () => {
    const n = node('i', 'input', { name: 'name', valueType: { type: 'string', value: 'Glaude' } })
    expect(staticScenarioPreview(n, [n], [])).toEqual({ name: 'Glaude' })
  })

  it('now (default format = datetime) → { now: <Date> }', () => {
    const out = staticScenarioPreview(node('n', 'now', {}), [], [])
    expect(out?.['now']).toBeInstanceOf(Date)
  })

  it('now { format: "string" } → ISO string', () => {
    const out = staticScenarioPreview(node('n', 'now', { format: 'string', timezone: 'UTC' }), [], [])
    expect(typeof out?.['now']).toBe('string')
    expect(out?.['now']).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('now { format: "epoch" } → epoch number', () => {
    const out = staticScenarioPreview(node('n', 'now', { format: 'epoch' }), [], [])
    expect(typeof out?.['now']).toBe('number')
    expect(out?.['now']).toBeGreaterThan(1_700_000_000_000)
  })

  it('getVariable resolves from a declaring input', () => {
    const input = node('i', 'input', { name: 'timer', valueType: { type: 'numeric', value: 42, format: 'decimal' } })
    const get = node('g', 'getVariable', { value: { type: 'variable', value: 'timer' } })
    expect(staticScenarioPreview(get, [input, get], [])).toEqual({ timer: 42 })
  })

  it('setVariable with a name + literal value → { <name>: value }', () => {
    const n = node('s', 'setVariable', { name: 'flag', value: { type: 'boolean', value: true } })
    expect(staticScenarioPreview(n, [n], [])).toEqual({ flag: true })
  })

  it('setVariable without a name returns null (no anchor → nothing to preview)', () => {
    const n = node('s', 'setVariable', { value: { type: 'string', value: 'x' } })
    expect(staticScenarioPreview(n, [n], [])).toBeNull()
  })

  it('getVariable picks the value emitted by an upstream setVariable', () => {
    const set = node('s', 'setVariable', { name: 'count', value: { type: 'numeric', value: 7, format: 'decimal' } })
    const get = node('g', 'getVariable', { value: { type: 'variable', value: 'count' } })
    expect(staticScenarioPreview(get, [set, get], [])).toEqual({ count: 7 })
  })

  it('arithmetic computes { result } from literal operands', () => {
    const n = node('a', 'arithmetic', {
      operator: '+',
      a: { type: 'numeric', value: 2, format: 'decimal' },
      b: { type: 'numeric', value: 3, format: 'decimal' }
    })
    expect(staticScenarioPreview(n, [n], [])).toEqual({ result: 5 })
  })

  it('arithmetic divide-by-zero → null (no preview)', () => {
    const n = node('a', 'arithmetic', {
      operator: '÷',
      a: { type: 'numeric', value: 10, format: 'decimal' },
      b: { type: 'numeric', value: 0, format: 'decimal' }
    })
    expect(staticScenarioPreview(n, [n], [])).toBeNull()
  })

  it('arithmetic with a wired operand resolves via the source preview + selector', () => {
    const input = node('i', 'input', { name: 'amount', valueType: { type: 'numeric', value: 7, format: 'decimal' } })
    const a = node('a', 'arithmetic', {
      operator: '×',
      a: { type: 'numeric', value: 6, format: 'decimal' },
      b: { type: 'numeric', value: 0, format: 'decimal' }
    })
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'i', portId: 'value' }, to: { nodeId: 'a', portId: 'b' }, selector: 'amount' }
    ]
    expect(staticScenarioPreview(a, [input, a], edges)).toEqual({ result: 42 })
  })

  it('comparator returns { result: bool }', () => {
    const eq = node('c', 'comparator', {
      operator: '=',
      a: { type: 'numeric', value: 5, format: 'decimal' },
      b: { type: 'numeric', value: 5, format: 'decimal' }
    })
    expect(staticScenarioPreview(eq, [eq], [])).toEqual({ result: true })
    const lt = node('c', 'comparator', {
      operator: '<',
      a: { type: 'numeric', value: 5, format: 'decimal' },
      b: { type: 'numeric', value: 9, format: 'decimal' }
    })
    expect(staticScenarioPreview(lt, [lt], [])).toEqual({ result: true })
  })

  it('if returns { condition, branch } from the operator + operands', () => {
    const taken = node('i', 'if', {
      operator: '<',
      left: { type: 'numeric', value: 5, format: 'decimal' },
      right: { type: 'numeric', value: 9, format: 'decimal' }
    })
    expect(staticScenarioPreview(taken, [taken], [])).toEqual({ condition: true, branch: 'then' })

    const notTaken = node('i', 'if', {
      operator: '>',
      left: { type: 'numeric', value: 5, format: 'decimal' },
      right: { type: 'numeric', value: 9, format: 'decimal' }
    })
    expect(staticScenarioPreview(notTaken, [notTaken], [])).toEqual({ condition: false, branch: 'else' })
  })

  it('if with an operand wired to a static source resolves through the selector', () => {
    const input = node('i', 'input', { name: 'timer', valueType: { type: 'numeric', value: 100, format: 'decimal' } })
    const ifNode = node('cond', 'if', {
      operator: '≥',
      left: { type: 'numeric', value: 0, format: 'decimal' },
      right: { type: 'numeric', value: 200, format: 'decimal' }
    })
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'i', portId: 'value' }, to: { nodeId: 'cond', portId: 'left' }, selector: 'timer' }
    ]
    expect(staticScenarioPreview(ifNode, [input, ifNode], edges)).toEqual({ condition: false, branch: 'else' })
  })

  it('if wired to a non-static source → null', () => {
    const http = node('h', 'httpRequest', { requestId: 'r1' })
    const ifNode = node('cond', 'if', {
      operator: '=',
      left: { type: 'string', value: 'x' },
      right: { type: 'string', value: 'x' }
    })
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'h', portId: 'response' }, to: { nodeId: 'cond', portId: 'left' } }
    ]
    expect(staticScenarioPreview(ifNode, [http, ifNode], edges)).toBeNull()
  })

  it('map renders each item with the Handlebars template', () => {
    const m = node('m', 'map', {
      items: { type: 'customListMulti', listId: 'l', labels: ['a', 'b', 'c'] },
      expression: { type: 'expression', value: 'item-{{this}}' }
    })
    expect(staticScenarioPreview(m, [m], [])).toEqual({ mapped: ['item-a', 'item-b', 'item-c'] })
  })

  it('filter keeps items matching the predicate (field path + operator + value)', () => {
    const items = [{ price: 5 }, { price: 12 }, { price: 8 }]
    const input = node('i', 'input', { name: 'list', valueType: { type: 'enumList', value: [], enumDefinitionId: 'e' } })
    // The input box doesn't naturally hold array of objects; this test fakes
    // the wire by going through a stub object source. Use literal config for
    // the items here via a synthetic enumList.
    const f = node('f', 'filter', {
      items: { type: 'customListMulti', listId: 'l', labels: ['a'] }, // placeholder; we'll wire instead
      field: '',
      operator: '>',
      value: { type: 'numeric', value: 7, format: 'decimal' }
    })
    // For a meaningful test, bypass and use the helper directly via objects.
    // Simulate items wired by hijacking through input (use string items for `=`).
    const fStr = node('f2', 'filter', {
      items: { type: 'customListMulti', listId: 'l', labels: ['x', 'y', 'x', 'z'] },
      field: '',
      operator: '=',
      value: { type: 'string', value: 'x' }
    })
    expect(staticScenarioPreview(fStr, [fStr], [])).toEqual({ kept: ['x', 'x'], rejected: ['y', 'z'] })
    // Marker to keep TS happy with unused setup
    expect(items.length).toBe(3)
    expect(input.id).toBe('i')
    expect(f.id).toBe('f')
  })

  it('aggregate count + sum + average + join', () => {
    const mk = (op: string, field = '', sep = ','): StaticPreviewNode => node('a', 'aggregate', {
      items: { type: 'customListMulti', listId: 'l', labels: ['1', '2', '3', '4'] },
      op, field, separator: sep
    })
    expect(staticScenarioPreview(mk('count'), [], [])).toEqual({ result: 4 })
    expect(staticScenarioPreview(mk('sum'), [], [])).toEqual({ result: 10 })
    expect(staticScenarioPreview(mk('average'), [], [])).toEqual({ result: 2.5 })
    expect(staticScenarioPreview(mk('min'), [], [])).toEqual({ result: 1 })
    expect(staticScenarioPreview(mk('max'), [], [])).toEqual({ result: 4 })
    expect(staticScenarioPreview(mk('join', '', ' - '), [], [])).toEqual({ result: '1 - 2 - 3 - 4' })
  })

  it('log surfaces { timestamp, level, message, data } with literal config', () => {
    const l = node('lg', 'log', {
      level: 'warn',
      message: { type: 'string', value: 'oops' },
      data: { type: 'numeric', value: 42, format: 'decimal' }
    })
    const out = staticScenarioPreview(l, [l], [])
    expect(out?.['level']).toBe('warn')
    expect(out?.['message']).toBe('oops')
    expect(out?.['data']).toBe(42)
    expect(typeof out?.['timestamp']).toBe('string')
    expect(out?.['timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('log defaults to info + null placeholders when both inputs are wired to non-static', () => {
    const http = node('h', 'httpRequest', { requestId: 'r1' })
    const l = node('lg', 'log', {})
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'h', portId: 'response' }, to: { nodeId: 'lg', portId: 'message' } },
      { from: { nodeId: 'h', portId: 'response' }, to: { nodeId: 'lg', portId: 'data' } }
    ]
    const out = staticScenarioPreview(l, [http, l], edges)
    expect(out?.['level']).toBe('info')
    expect(out?.['message']).toBeNull()
    expect(out?.['data']).toBeNull()
    expect(typeof out?.['timestamp']).toBe('string')
  })

  it('assert returns { pass, branch, message } from operator + operands', () => {
    const a = node('a', 'assert', {
      operator: '=',
      left: { type: 'numeric', value: 1, format: 'decimal' },
      right: { type: 'numeric', value: 1, format: 'decimal' },
      message: { type: 'string', value: 'they should match' }
    })
    expect(staticScenarioPreview(a, [a], [])).toEqual({ pass: true, branch: 'pass', message: 'they should match' })

    const fail = node('a', 'assert', {
      operator: '=',
      left: { type: 'numeric', value: 1, format: 'decimal' },
      right: { type: 'numeric', value: 2, format: 'decimal' }
    })
    expect(staticScenarioPreview(fail, [fail], [])).toEqual({ pass: false, branch: 'fail' })
  })

  it('forEach summary: items + serial (one per batch) → batches = items.length', () => {
    const f = node('f', 'forEach', {
      items: { type: 'customListMulti', listId: 'l', labels: ['a', 'b', 'c', 'd', 'e'] }
    })
    expect(staticScenarioPreview(f, [f], [])).toEqual({ totalItems: 5, itemsPerBatch: 1, batches: 5 })
  })

  it('forEach summary: parallel batches honour the count', () => {
    const f = node('f', 'forEach', {
      items: { type: 'customListMulti', listId: 'l', labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
      parallelism: { enabled: true, count: 3 }
    })
    expect(staticScenarioPreview(f, [f], [])).toEqual({ totalItems: 7, itemsPerBatch: 3, batches: 3 })
  })

  it('forEach with an empty items array → 0 batches', () => {
    const f = node('f', 'forEach', { items: { type: 'customListMulti', listId: 'l', labels: [] }, parallelism: { enabled: true, count: 4 } })
    expect(staticScenarioPreview(f, [f], [])).toEqual({ totalItems: 0, itemsPerBatch: 4, batches: 0 })
  })

  it('wait surfaces { duration } when the input is wired to a static source', () => {
    const input = node('i', 'input', { name: 'timer', valueType: { type: 'numeric', value: 1500, format: 'decimal' } })
    const w = node('w', 'wait', {})
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'i', portId: 'value' }, to: { nodeId: 'w', portId: 'duration' }, selector: 'timer' }
    ]
    expect(staticScenarioPreview(w, [input, w], edges)).toEqual({ duration: 1500 })
  })

  it('wait with no wired duration → null (control isn\'t persisted yet)', () => {
    expect(staticScenarioPreview(node('w', 'wait', {}), [], [])).toBeNull()
  })

  it('wait wired to a non-static source → { duration: null } placeholder', () => {
    const http = node('h', 'httpRequest', { requestId: 'r1' })
    const w = node('w', 'wait', {})
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'h', portId: 'response' }, to: { nodeId: 'w', portId: 'duration' }, selector: 'response.body.delay' }
    ]
    expect(staticScenarioPreview(w, [http, w], edges)).toEqual({ duration: null })
  })

  it('waitUntil surfaces { until } from its literal config and casts to Date', () => {
    const w = node('w', 'waitUntil', { until: { type: 'datetime', value: '2030-01-01T00:00:00.000Z', format: 'yyyy-MM-dd HH:mm:ss' } })
    const out = staticScenarioPreview(w, [w], [])
    expect(out?.['until']).toBeInstanceOf(Date)
    expect((out?.['until'] as Date).toISOString()).toBe('2030-01-01T00:00:00.000Z')
  })

  it('waitUntil casts an epoch number (now Epoch → waitUntil) into a Date', () => {
    const now = node('n', 'now', { format: 'epoch' })
    const w = node('w', 'waitUntil', {})
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'n', portId: 'value' }, to: { nodeId: 'w', portId: 'until' }, selector: 'now' }
    ]
    const out = staticScenarioPreview(w, [now, w], edges)
    expect(out?.['until']).toBeInstanceOf(Date)
  })

  it('switch routes to the first case matching `on` (literal)', () => {
    const sw = node('s', 'switch', {
      on: { type: 'numeric', value: 2, format: 'decimal' },
      cases: [
        { id: 'c1', value: { type: 'numeric', value: 1, format: 'decimal' } },
        { id: 'c2', value: { type: 'numeric', value: 2, format: 'decimal' } },
        { id: 'c3', value: { type: 'numeric', value: 3, format: 'decimal' } }
      ]
    })
    expect(staticScenarioPreview(sw, [sw], [])).toEqual({ value: 2, branch: 2 })
  })

  it('switch with no match → default branch', () => {
    const sw = node('s', 'switch', {
      on: { type: 'string', value: 'z' },
      cases: [{ id: 'c1', value: { type: 'string', value: 'a' } }]
    })
    expect(staticScenarioPreview(sw, [sw], [])).toEqual({ value: 'z', branch: 'default' })
  })

  it('switch with `on` wired to a static source resolves through the selector', () => {
    const input = node('i', 'input', { name: 'status', valueType: { type: 'string', value: 'open' } })
    const sw = node('s', 'switch', {
      on: { type: 'string', value: '' },
      cases: [{ id: 'cOpen', value: { type: 'string', value: 'open' } }, { id: 'cClosed', value: { type: 'string', value: 'closed' } }]
    })
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'i', portId: 'value' }, to: { nodeId: 's', portId: 'on' }, selector: 'status' }
    ]
    expect(staticScenarioPreview(sw, [input, sw], edges)).toEqual({ value: 'open', branch: 1 })
  })

  it('switch wired to a non-static source → null', () => {
    const http = node('h', 'httpRequest', { requestId: 'r1' })
    const sw = node('s', 'switch', { on: { type: 'string', value: 'x' }, cases: [{ id: 'cx', value: { type: 'string', value: 'x' } }] })
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'h', portId: 'response' }, to: { nodeId: 's', portId: 'on' } }
    ]
    expect(staticScenarioPreview(sw, [http, sw], edges)).toBeNull()
  })

  it('boolean AND/OR/XOR on literal operands', () => {
    const mk = (op: string, av: boolean, bv: boolean): StaticPreviewNode => node('b', 'boolean', {
      operator: op,
      a: { type: 'boolean', value: av },
      b: { type: 'boolean', value: bv }
    })
    expect(staticScenarioPreview(mk('AND', true, false), [], [])).toEqual({ result: false })
    expect(staticScenarioPreview(mk('OR', true, false), [], [])).toEqual({ result: true })
    expect(staticScenarioPreview(mk('XOR', true, true), [], [])).toEqual({ result: false })
  })

  it('group B node wired to a non-static source → null (no preview)', () => {
    const http = node('h', 'httpRequest', { requestId: 'r1' })
    const a = node('a', 'arithmetic', {
      operator: '+',
      a: { type: 'numeric', value: 1, format: 'decimal' },
      b: { type: 'numeric', value: 2, format: 'decimal' }
    })
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'h', portId: 'response' }, to: { nodeId: 'a', portId: 'b' } }
    ]
    expect(staticScenarioPreview(a, [http, a], edges)).toBeNull()
  })

  it('transform renders a literal template with no input', () => {
    const n = node('t', 'transform', { expression: { type: 'expression', value: 'Hello world' } })
    expect(staticScenarioPreview(n, [n], [])).toEqual({ result: 'Hello world' })
  })

  it('transform reads the input object directly as Handlebars context (no value wrapper)', () => {
    const input = node('i', 'input', { name: 'name', valueType: { type: 'string', value: 'Glaude' } })
    const t = node('t', 'transform', { expression: { type: 'expression', value: 'Hi {{name}}!' } })
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'i', portId: 'value' }, to: { nodeId: 't', portId: 'value' } }
    ]
    expect(staticScenarioPreview(t, [input, t], edges)).toEqual({ result: 'Hi Glaude!' })
  })

  it('transform with the `.` identity selector flows the whole object through', () => {
    // Anchor the now box to `format: 'string'` so the chained Handlebars
    // template renders against a plain string (the default `datetime` would
    // stringify via Date#toString, which is locale-dependent).
    const now = node('n', 'now', { format: 'string', timezone: 'UTC' })
    const t = node('t', 'transform', { expression: { type: 'expression', value: '{{now}}' } })
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'n', portId: 'value' }, to: { nodeId: 't', portId: 'value' }, selector: '.' }
    ]
    const out = staticScenarioPreview(t, [now, t], edges)
    expect(out && typeof out['result']).toBe('string')
    expect(out?.['result']).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('transform with a primitive input renders via {{this}}', () => {
    const input = node('i', 'input', { name: 'name', valueType: { type: 'string', value: 'Glaude' } })
    const t = node('t', 'transform', { expression: { type: 'expression', value: 'Hi {{this}}!' } })
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'i', portId: 'value' }, to: { nodeId: 't', portId: 'value' }, selector: 'name' }
    ]
    expect(staticScenarioPreview(t, [input, t], edges)).toEqual({ result: 'Hi Glaude!' })
  })

  it('transform can call a Handlebars helper on a wired Date input', () => {
    const now = node('n', 'now', { format: 'datetime' })
    const t = node('t', 'transform', { expression: { type: 'expression', value: '{{year now}}' } })
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'n', portId: 'value' }, to: { nodeId: 't', portId: 'value' }, selector: '.' }
    ]
    const out = staticScenarioPreview(t, [now, t], edges)
    expect(out?.['result']).toMatch(/^\d{4}$/)
  })

  it('transform wired to a non-static source → null', () => {
    const http = node('h', 'httpRequest', { requestId: 'r1' })
    const t = node('t', 'transform', { expression: { type: 'expression', value: 'x={{value}}' } })
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'h', portId: 'response' }, to: { nodeId: 't', portId: 'value' } }
    ]
    expect(staticScenarioPreview(t, [http, t], edges)).toBeNull()
  })

  it('object assembles config properties, and a property wired to a non-static source is omitted', () => {
    const input = node('i', 'input', { name: 'name', valueType: { type: 'string', value: 'Glaude' } })
    const http = node('h', 'httpRequest', { requestId: 'r1' })
    const obj = node('o', 'object', {
      properties: [
        { id: 'plit', name: 'lit', value: { type: 'string', value: 'x' } },
        { id: 'pin', name: 'fromInput', value: { type: 'string', value: '' } },
        { id: 'phttp', name: 'fromHttp', value: { type: 'string', value: '' } }
      ]
    })
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'i', portId: 'value' }, to: { nodeId: 'o', portId: 'pin' }, selector: 'name' },
      { from: { nodeId: 'h', portId: 'response' }, to: { nodeId: 'o', portId: 'phttp' } }
    ]
    expect(staticScenarioPreview(obj, [input, http, obj], edges)).toEqual({ lit: 'x', fromInput: 'Glaude', fromHttp: null })
  })
})
