/**
 * Build a restorm **scenario** (dataflow graph) from an imported Postman/Bruno
 * **workflow** — an ordered list of requests, each with optional pre-request and
 * post-response scripts.
 *
 * Per request the builder emits a small chain:
 *
 * ```
 *   [pre-request code] --done--> httpRequest --response--> [post-response code]
 * ```
 *
 * and links consecutive requests in execution order via `done`→`in`, so the
 * scenario replays the collection's sequence. Pre/post scripts become `code`
 * nodes carrying the VERBATIM source (`config.code`, `language: javascript`) plus
 * a `scriptMode` marker (`postman-prerequest` / `postman-postresponse` /
 * `bruno-*`); the
 * `codeExecutor` runs them on the Postman/Bruno runtime (see `codeSandbox`),
 * so variable writes (`pm.environment.set` / `bru.setVar`) persist to the run and
 * later requests resolve `{{var}}`. A request with no scripts becomes a bare
 * `httpRequest` node, so a script-free collection still imports cleanly.
 *
 * Flow control: when a request's script statically calls
 * `setNextRequest('Name')` (any dialect prefix) the chain edge is redirected to
 * that request instead of the linear next; `setNextRequest(null)` ends the run;
 * a computed / multiple call is left on the linear order with a note on the box
 * (best-effort, never a silent jump).
 *
 * Ids are derived from the request ids (not `Date.now()`), so re-importing the
 * same workflow produces the same graph — the idempotency the import pipeline
 * relies on.
 */
import type { Scenario, ScenarioNode, ScenarioEdge } from '../../../shared/types/scenario'
import { defaultPortsForKind } from '../../../shared/scenarioNodePorts'

/** One request of the workflow, with its (verbatim) pre/post scripts. */
export interface WorkflowRequestStep {
  /** Id of the imported request item this node executes. */
  requestId: string
  /** Display label for the box. */
  name: string
  /** Verbatim pre-request script source (empty / absent → no pre node). */
  prerequest?: string
  /** Verbatim post-response / test script source (empty / absent → no post node). */
  postresponse?: string
  /** Which scripting dialect the scripts are written in. */
  source: 'postman' | 'bruno'
}

export interface WorkflowToScenarioInput {
  /** Stable scenario id. */
  id: string
  /** Scenario name. */
  name: string
  /** Requests in execution order. */
  steps: WorkflowRequestStep[]
}

const COL_WIDTH = 360
const ROW_PRE = 0
const ROW_HTTP = 180
const ROW_POST = 360

function codeNode(id: string, code: string, scriptMode: string, x: number, y: number, note: string, requestId?: string): ScenarioNode {
  const ports = defaultPortsForKind('code')
  return {
    id: id,
    kind: 'code',
    // A pre-request node carries the bound `requestId` so the executor can seed
    // `pm.request`/`req` from the real request (read-modify-write of url/body).
    config: { language: 'javascript', code, scriptMode, ...(requestId !== undefined ? { requestId } : {}) },
    inputs: ports.inputs,
    outputs: ports.outputs,
    position: { x, y },
    note
  }
}

function httpNode(id: string, requestId: string, label: string, x: number, y: number): ScenarioNode {
  const ports = defaultPortsForKind('httpRequest')
  return {
    id: id,
    kind: 'httpRequest',
    config: { requestId, label },
    inputs: ports.inputs,
    outputs: ports.outputs,
    position: { x, y }
  }
}

function edge(id: string, from: string, fromPort: string, to: string, toPort: string, selector?: string): ScenarioEdge {
  return {
    id: id,
    from: { nodeId: from, portId: fromPort },
    to: { nodeId: to, portId: toPort },
    ...(selector !== undefined ? { selector } : {})
  }
}

/** A `setNextRequest` directive found in a step's scripts. */
type NextDirective =
  | { kind: 'linear' }            // no setNextRequest — fall through to the next request
  | { kind: 'static'; name: string } // setNextRequest('Name') — a single string literal
  | { kind: 'stop' }              // setNextRequest(null) — end the run here
  | { kind: 'dynamic' }           // a computed / multiple setNextRequest — can't resolve statically

/** Detect a static `setNextRequest` in a script (any prefix: `pm.` / `postman.`
 * / `pm.execution.` / `bru.` / `bru.runner.`). A single string-literal argument
 * is resolvable to a control edge; `null` ends the run; anything computed or
 * more than one call is left to the linear order (annotated, never silently
 * dropped). */
function detectNext(script: string): NextDirective {
  const calls = [...script.matchAll(/setNextRequest\s*\(([^)]*)\)/g)]
  if (calls.length === 0) return { kind: 'linear' }
  if (calls.length > 1) return { kind: 'dynamic' }
  const arg = (calls[0][1] ?? '').trim()
  if (arg === 'null' || arg === '') return { kind: 'stop' }
  const lit = /^(['"`])(.*)\1$/.exec(arg)
  if (lit) return { kind: 'static', name: lit[2] }
  return { kind: 'dynamic' }
}

interface BuiltStep {
  step: WorkflowRequestStep
  head: string
  tail: string
  tailNode: ScenarioNode
  next: NextDirective
}

/** Convert an ordered workflow into a runnable scenario graph. */
export function workflowToScenario(input: WorkflowToScenarioInput): Scenario {
  const nodes: ScenarioNode[] = []
  const edges: ScenarioEdge[] = []
  const built: BuiltStep[] = []
  // Resolve a `setNextRequest('Name')` to a request — last wins on duplicate names.
  const indexByName = new Map<string, number>()
  input.steps.forEach((step, i) => indexByName.set(step.name, i))

  // Pass 1 — nodes + intra-request edges.
  input.steps.forEach((step, i) => {
    const x = i * COL_WIDTH
    // Keep the source verbatim; trim only to decide whether a script exists.
    const preSrc = step.prerequest ?? ''
    const postSrc = step.postresponse ?? ''
    const hasPre = preSrc.trim() !== ''
    const hasPost = postSrc.trim() !== ''
    const preId = `${step.requestId}:pre`
    const httpId = `${step.requestId}:http`
    const postId = `${step.requestId}:post`

    const preNode = hasPre ? codeNode(preId, preSrc, `${step.source}-prerequest`, x, ROW_PRE, `Pre-request — ${step.name}`, step.requestId) : undefined
    const httpNodeRef = httpNode(httpId, step.requestId, step.name, x, ROW_HTTP)
    const postNode = hasPost ? codeNode(postId, postSrc, `${step.source}-postresponse`, x, ROW_POST, `Post-response — ${step.name}`) : undefined
    if (preNode) nodes.push(preNode)
    nodes.push(httpNodeRef)
    if (postNode) nodes.push(postNode)

    // Intra-request wiring: pre runs first (sets variables) then the request;
    // its mutated request (`pm.request`/`req`) flows to the request's override;
    // the request's response feeds the post-response script.
    if (hasPre) {
      edges.push(edge(`e:${step.requestId}:pre-http`, preId, 'done', httpId, 'in'))
      edges.push(edge(`e:${step.requestId}:pre-override`, preId, 'result', httpId, 'requestOverride', '.request'))
    }
    if (hasPost) edges.push(edge(`e:${step.requestId}:http-post`, httpId, 'response', postId, 'value', '.'))

    built.push({
      step,
      head: hasPre ? preId : httpId,
      tail: hasPost ? postId : httpId,
      tailNode: postNode ?? httpNodeRef,
      next: detectNext(`${preSrc}\n${postSrc}`)
    })
  })

  // Pass 2 — chain edges in execution order, honouring static `setNextRequest`.
  built.forEach((b, i) => {
    let targetIndex = i + 1 // linear default
    let annotation: string | null = null
    switch (b.next.kind) {
      case 'stop':
        return // ends the run — no outgoing chain edge
      case 'static': {
        const idx = indexByName.get(b.next.name)
        if (idx === undefined) annotation = `setNextRequest("${b.next.name}") — target not found, using linear order`
        else targetIndex = idx
        break
      }
      case 'dynamic':
        annotation = 'setNextRequest is computed at run time — wired in linear order, verify the jump manually'
        break
      default:
        break // linear
    }
    if (annotation) b.tailNode.note = b.tailNode.note ? `${b.tailNode.note} · ${annotation}` : annotation
    if (targetIndex < built.length) {
      edges.push(edge(`e:${b.step.requestId}:chain`, b.tail, 'done', built[targetIndex].head, 'in'))
    }
  })

  return { type: 'scenario', id: input.id, name: input.name, tags: [], params: [], nodes, edges, items: [] }
}
