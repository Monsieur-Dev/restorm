# HTTP mock server

Restorm can **act as a local HTTP server**, not just call one. A request switched to *server mode* stops sending and instead **listens** on `localhost:<port>` for its `METHOD` + `PATH`, answering every matching inbound request with a response you configure (status, headers, body). It is the request-side mirror of the Socket.IO / raw-WebSocket / MQTT server modes — the same `localhost`-fixed UI, the same `SRV` capsule badge, the same one-server-per-port behaviour, and the same teardown on file close / quit.

This doc covers:

1. [Creating a mock](#creating-a-mock)
2. [How a route is matched](#how-a-route-is-matched)
3. [Sharing one port across protocols](#sharing-one-port-across-protocols)
4. [Templating the response](#templating-the-response)
5. [How it differs from Postman Mock Servers](#how-it-differs-from-postman-mock-servers)

---

## Creating a mock

Right-click a folder → **Add → HTTP server**. You get an HTTP request pre-set to `server: true`, method `GET`, address `localhost:8080/`, and status `200`. In the request panel:

- the **host is fixed to `localhost`** — only the **port** and **path** are editable (next to the existing method selector);
- the **Send** button becomes a **Listen ↔ Stop** toggle;
- the response panel shows the live state — *Not listening*, or *Listening — N request(s) served* once a client hits the route;
- the **status / headers / body** you configure on the request *are* the response the mock serves.

Press **Listen** to bind the port and start answering; press **Stop** (or close the file / quit) to free it.

## How a route is matched

A route is the pair `METHOD + PATH` (e.g. `GET /pets`, `POST /pets`). Matching is **exact** on the pathname — the query string is ignored. An inbound request that matches a registered route runs that route's response; anything else on the port gets a plain **404**.

Two routes **collide** only when they share the same `METHOD`, `PATH`, *and* port — starting the second one fails with a "already listening" message. Different paths (or different methods on the same path) coexist freely on one port.

The port is released as soon as its **last** route stops, so a port is never left bound with no UI to stop it.

## Sharing one port across protocols

Restorm holds **at most one OS socket per port**. A single shared per-port server dispatches by protocol: HTTP requests go to the mock routes (`request`), WebSocket / Socket.IO upgrades go to their handlers (`upgrade`). That means an HTTP mock on `:8080` and a Socket.IO or raw-WebSocket server on `:8080` can run **at the same time on the same port** — each answers the traffic it owns, and the port frees only once every route across every protocol has stopped.

## Templating the response

The configured headers and body are resolved **at serve time**: any `{{var}}` is substituted from the active environment on every inbound request, not frozen when you press Listen. Edit an environment variable while the mock is listening and the next response reflects it.

## How it differs from Postman Mock Servers

Restorm's mock is a **local, fully-owned** server. Postman *Mock Servers* are a hosted cloud feature: requests round-trip to Postman's infrastructure, examples live in the cloud, and the served responses are bounded by what that service supports.

| | Restorm HTTP mock | Postman Mock Servers |
|---|---|---|
| Where it runs | Your machine (`localhost:<port>`) | Postman cloud |
| Network round-trip | None — in-process | Every call leaves your machine |
| Response source | The request's own status / headers / body, fully editable | Saved cloud examples |
| Templating | `{{var}}` resolved from the active environment at serve time | Limited |
| Port sharing | Shares one OS port with WS / Socket.IO servers | N/A |
| Offline | Works with no internet | Requires connectivity |

In short: **local, scriptable through your own environment, full control over the wire bytes, no cloud dependency.**
