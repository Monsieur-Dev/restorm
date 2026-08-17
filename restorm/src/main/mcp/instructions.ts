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
- Environment + variables: values referenced anywhere via Handlebars {{name}}. Manage the environments themselves (incl. nested sub-environments) with list_environments / create_environment (pass parentEnvironmentId to nest) / rename_environment / update_environment (name/icon/color) / delete_environment; set/read their variables with set_env_variable / list_env_variables / delete_env_variable; the active env is get_active_env.

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

API DESIGNS (design an API, then serve it)
- A *design* is an editable API blueprint: models (typed properties, named examples, inheritance), enums, route groups + routes (parameter->property links, per-code responses, input body). Build one from scratch (create_design, create_design_model, set_design_property, create_design_enum, create_design_route_group, create_design_route) or derive it from an imported API's env folder (create_design_from_documentation). Entities resolve by id OR unique name.
- Generators do the boring parts: generate_design_crud(model) mints a plural group + 5 linked routes; generate_design_search_routes(model) adds query params for every searchable property. set_design_example seeds the data the server responds with.
- get_design returns the full structure PLUS validation issues (stable codes + entity paths) — fix them before serving; serve_design refuses an invalid design and echoes the issues.
- serve_design spins a local HTTP server of the whole design: named examples served, inputs constraint-validated (400), group auth enforced by PRESENCE (401), /swagger.json self-description. get_design_server_status reports per-route/per-code call counters; set_design_route_response force-steers a route's answer (or resets it) while serving; stop_design_server frees the port. export_design returns the OpenAPI 3.1 descriptor.

INSTANCES (multiple windows)
- Several restorm instances can run at once, each addressed by session name via the reserved \`__session\` key on any tool call. list-instances shows every instance that ACCEPTS MCP, with its open fileName + name — call it before targeting one.
- There is NO auto-spawn: if no instance is reachable you get a clear error. Use create_instance to launch one explicitly (optionally for a file / with a name). Creation is refused if another instance already has that name OR that file open (one instance per file).
- The user can CUT MCP on an instance (the "stop" button) to halt a misbehaving agent. A cut instance REFUSES every command and disappears from list-instances; targeting it by name is refused, never redirected — respect that, do not try to route around it.
- terminate_instance closes an instance cleanly (File->Quit, never a force-kill). With unsaved changes and autosave off, pass save:true/false; omit save to let the user confirm via a modal (the call returns "awaiting user confirmation" without closing).

CONVENTIONS
- Everything is addressed by id; list/search/get tools return the ids you pass to mutating tools.
- User-facing text fields accept {{handlebars}} + env variables.
- Prefer the self-describing tools (describe_scenario_kinds, the list_*/get_* family) over assumptions — the tree, kinds, and ports are all queryable at runtime.`
