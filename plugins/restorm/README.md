# Restorm plugin for Claude Code

Connect Claude to your running [Restorm](https://restorm.app) instance over the
Model Context Protocol. Installing this plugin registers the `restorm` MCP server
(`npx -y restorm-mcp`), a zero-dependency bridge that discovers your local
Restorm automatically — no port or token to copy.

## Install

```bash
/plugin marketplace add Monsieur-Dev/restorm
/plugin install restorm@restorm-marketplace
```

## Prerequisites

- Node.js ≥ 18 (for `npx`).
- A Restorm instance running with its MCP server enabled (the default).

Claude can then read your project, create and run requests across every
protocol, drive scenarios, design and mock APIs, and steer the UI.

> **Security:** connecting Claude to Restorm gives it full access to your
> Restorm tools (running requests, your project files, Pro tools), using your
> resolved secrets. Only connect assistants you trust, and keep Claude's
> approval prompts on. Full guide: <https://restorm.app/en/docs/outils/mcp>.
