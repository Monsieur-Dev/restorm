# Restorm UI Overview

This document summarizes the initial Restorm user interface draft and local test setup.

## Layout

- **Titlebar**: Uses the `Titlebar` component from `electron-core-ui` with a minimal `MenuBar` on the left.
- **Left panel (Collections)**: A `ListView` displays a static \"Collections\" tree with a few sample REST requests (e.g. `GET /pets`, `GET /pets/{id}`, `POST /pets`).
- **Splitter**: A vertical `Sash` separates the left `ListView` from the main workbench area and lets the user resize the collections panel.
- **Workbench**: The central area uses the local `Workbench` wrapper around `EditorWorkbench`, with a single group and a few static tabs corresponding to example REST operations.
- **Statusbar**: A `Statusbar` component is rendered at the bottom of the window.

## RequestTabView

Each workbench tab renders the `RequestTabView` component at the top of its content area.  
For now, `RequestTabView` only shows a simple \"hello world\" text; it will later become the main UI for editing and sending REST/gRPC/websocket requests.

## Axios

The `axios` dependency is added to `restorm/package.json` for future HTTP calls.  
No runtime usage is implemented yet; it will be wired when the request UI becomes functional.

## Swagger Petstore Docker Service

A local Swagger Petstore instance is provided via Docker for future testing:

- **Compose file**: `tests/docker/docker-compose.yml`
- **Service**:
  - Image: `swaggerapi/petstore`
  - Service name: `petstore`
  - Port mapping: `8080:8080`

### NPM Scripts

- In the `restorm` project:
  - `npm run docker:up` – starts the Petstore container in detached mode.
  - `npm run docker:down` – stops and removes the Petstore container.
- At the monorepo root:
  - `npm run restorm:docker:up` – runs `docker:up` inside the `restorm` folder.
  - `npm run restorm:docker:down` – runs `docker:down` inside the `restorm` folder.


