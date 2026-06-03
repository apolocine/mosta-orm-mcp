# @mostajs/orm-mcp

> MCP server for **[@mostajs/orm](https://www.npmjs.com/package/@mostajs/orm)** — lets AI dev tools (Claude, Cursor, Cline…) **generate `EntitySchema`s, lint them (24 rules), and produce SQL migrations** directly from a prompt.

[![npm](https://img.shields.io/npm/v/@mostajs/orm-mcp.svg)](https://www.npmjs.com/package/@mostajs/orm-mcp)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

## Tools

| Tool | What it does |
|---|---|
| `mostajs_generate_schema` | Build a typed `EntitySchema` (TS) from an entity name + fields (+ relations). Runs the validator on the result. |
| `mostajs_validate` | Lint one or more `EntitySchema`s with the built-in conceptual validator (24 rules). |
| `mostajs_create_migration` | Diff two schema sets → SQL migration (`diffSchemas` + `generateMigrationSQL`). |

All three reuse `@mostajs/orm`'s public API — no logic is reinvented.

## Use it (hosted)

A public instance runs at **`https://orm-mcp.amia.fr/mcp`** (Streamable HTTP). Add it to your MCP client:

```jsonc
{
  "mcpServers": {
    "mostajs-orm": { "url": "https://orm-mcp.amia.fr/mcp" }
  }
}
```

Clients that only speak stdio can bridge it:

```bash
npx mcp-remote https://orm-mcp.amia.fr/mcp
```

> Visiting `https://orm-mcp.amia.fr/mcp` in a browser returns a JSON-RPC `405` — that is expected (MCP is POST-only). The human-readable info page is the root `/`.

## Run it (local, stdio)

```bash
npx @mostajs/orm-mcp        # stdio transport — the AI tool spawns this process
```

Local MCP config (Claude Desktop / Cursor / Cline):

```jsonc
{
  "mcpServers": {
    "mostajs-orm": { "command": "npx", "args": ["-y", "@mostajs/orm-mcp"] }
  }
}
```

In stdio mode, `mostajs_validate` also accepts a `sourceRoot` to enable cross-file rules (it reads the local filesystem — disabled on the hosted server for safety).

## Run it (self-hosted HTTP)

```bash
PORT=14510 npx @mostajs/orm-mcp        # or: npx @mostajs/orm-mcp --http
```

Serves the MCP endpoint at `/mcp` (POST) and a health/info page at `/`.

## End-to-end example

Want to see the schemas this server generates actually **run**? Sample
[`18-mcp-to-running-app`](https://github.com/apolocine/mosta-orm-samples/tree/main/examples/18-mcp-to-running-app)
takes it the whole way: this MCP generates the `EntitySchema` for an e-commerce model
(users/products/orders), then [`@mostajs/orm`](https://www.npmjs.com/package/@mostajs/orm)
applies them and the app runs on **`sqljs`** (SQLite WASM, zero native binary). Its
`scripts/02-report.sh` produces a standalone HTML report — the MCP exchange next to the
real insert/select output.

```bash
npx @mostajs/orm-samples scaffold 18-mcp-to-running-app ~/my-mcp-app
cd ~/my-mcp-app && bash scripts/02-report.sh   # → report.html
```

## License

**AGPL-3.0-or-later** — © Dr Hamid MADANI. Commercial licensing for `@mostajs/orm`: drmdh@msn.com.
