/**
 * The `instructions` blob restorm sends to MCP clients on `initialize`.
 * A fresh client (typically an AI agent) reads this FIRST to orient
 * itself — so it can use restorm out-of-the-box without trial-and-error.
 *
 * Keep it a concise but self-sufficient "read me first": what restorm is,
 * the object model, the core workflows, and the discovery tools that let a
 * client learn the rest at runtime. When you add a tool group or change a
 * core workflow, update this so the orientation stays accurate.
 */
export const RESTORM_MCP_INSTRUCTIONS = `restorm is a desktop API client (like Postman/Insomnia) you drive over MCP. You can open projects, author and run API requests (REST/GraphQL/gRPC/WebSocket), manage environments + variables, and build/run visual *scenarios* (a dataflow graph of actions). Tools mutate the live app the user sees — changes are immediate and visible.

OBJECT MODEL
- Project: a .restorm file. One project is open per window. Items live in a tree.
- Folder / env-folder: containers. An *env-folder* additionally owns environments + variables (the scope where {{variables}} resolve). A request inherits the environment of its nearest env-folder.
- Request: one API call (method/url/headers/body/auth), protocol REST/GraphQL/gRPC/WebSocket.
- Scenario: a dataflow graph of *nodes* (boxes) wired by *edges*. Not a script — a node runs once all its wired inputs resolve; independent nodes run in parallel. See "Scenarios" below.
- Environment + variables: values referenced anywhere via Handlebars {{name}}. Set/read with set_env_variable / list_env_variables; the active env is get_active_env.

START HERE (discovery — call these before guessing)
- get_current_tab: what the user is looking at right now.
- open_project (by absolute path) / create_project. list_recent_projects shows recent files to open. list_favorites shows the user's starred items.
- list_folders / list_requests: walk the tree. search: full-text find across the project.
- get_request / get_response / get_response_history: inspect a request + its results.

RUN A REQUEST
- run_request (by item id) executes it in the app; get_response returns the result. run_request_batch runs several. Values support {{handlebars}} resolved against the active environment.

SCENARIOS (the dataflow engine)
- Build: create_scenario, then create_scenario_node for each box. **Call describe_scenario_kinds first** — it lists every node kind with its purpose, ports (inputs/outputs + their flow class), and config keys, so you wire them correctly. connect_scenario_nodes / disconnect_scenario_nodes wire edges (output port -> input port; an edge may carry a JSON selector to reshape the value in transit). list_scenario_nodes / get_scenario inspect the graph.
- Execution model: data-driven. A node fires when all its WIRED inputs have arrived (unwired inputs are not awaited). Nodes with no inputs start immediately, in parallel. Branch with 'if'/'switch'; iterate with 'forEach'/'for'; loop with 'while'/'doWhile' (the 'if' mechanism + a user-wired edge back into the node). 'log' writes to the run log.
- Run + observe: run_scenario returns a runId. get_scenario_run_status(runId) returns status + the full run log (incl. sub-scenario runs) DURING and after the run. list_scenario_runs finds runs you didn't start (e.g. a Play-button run from the UI). stop_scenario_run cancels.

CONVENTIONS
- Everything is addressed by id; list/search/get tools return the ids you pass to mutating tools.
- User-facing text fields accept {{handlebars}} + env variables.
- Prefer the self-describing tools (describe_scenario_kinds, the list_*/get_* family) over assumptions — the tree, kinds, and ports are all queryable at runtime.`
