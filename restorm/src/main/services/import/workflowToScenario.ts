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

function codeNode(id: string, code: string, scriptMode: string, x: number, y: number, note: string): ScenarioNode {
  const ports = defaultPortsForKind('code')
  return {
    id: id,
    kind: 'code',
    config: { language: 'javascript', code, scriptMode },
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

/** Convert an ordered workflow into a runnable scenario graph. */
export function workflowToScenario(input: WorkflowToScenarioInput): Scenario {
  const nodes: ScenarioNode[] = []
  const edges: ScenarioEdge[] = []
  // The node a downstream `done`→`in` edge should chain FROM (the previous
  // request's tail) — null for the first request (it runs at start).
  let prevTail: string | null = null

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

    if (hasPre) nodes.push(codeNode(preId, preSrc, `${step.source}-prerequest`, x, ROW_PRE, `Pre-request — ${step.name}`))
    nodes.push(httpNode(httpId, step.requestId, step.name, x, ROW_HTTP))
    if (hasPost) nodes.push(codeNode(postId, postSrc, `${step.source}-postresponse`, x, ROW_POST, `Post-response — ${step.name}`))

    // Intra-request wiring: pre runs first (sets variables) then the request;
    // the request's response feeds the post-response script.
    if (hasPre) edges.push(edge(`e:${step.requestId}:pre-http`, preId, 'done', httpId, 'in'))
    if (hasPost) edges.push(edge(`e:${step.requestId}:http-post`, httpId, 'response', postId, 'value', '.'))

    // Cross-request chaining in execution order.
    const head = hasPre ? preId : httpId
    const tail = hasPost ? postId : httpId
    if (prevTail !== null) edges.push(edge(`e:${step.requestId}:chain`, prevTail, 'done', head, 'in'))
    prevTail = tail
  })

  return { type: 'scenario', id: input.id, name: input.name, tags: [], params: [], nodes, edges, items: [] }
}
