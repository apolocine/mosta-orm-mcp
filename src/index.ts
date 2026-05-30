#!/usr/bin/env node
/**
 * @mostajs/orm-mcp — Model Context Protocol server exposing @mostajs/orm's
 * schema tooling to AI dev tools (Claude, Cursor, Cline…).
 *
 * Tools:
 *   - mostajs_generate_schema  : build an EntitySchema (TS) from name + fields
 *   - mostajs_validate         : lint EntitySchemas with the 24-rule validator
 *   - mostajs_create_migration : diff two schema sets → SQL migration
 *
 * All three REUSE @mostajs/orm's public API (validateSchemas, diffSchemas,
 * generateMigrationSQL) — no logic is reinvented here.
 *
 * Transports:
 *   - stdio (default)          : local use; the AI tool spawns this process.
 *   - Streamable HTTP (--http  : remote/hosted (e.g. https://orm-mcp.amia.fr/mcp),
 *     or PORT env set)           behind a reverse proxy.
 *
 * Security: the `sourceRoot` option of `mostajs_validate` reads the filesystem.
 * It is ALLOWED in stdio mode (runs on the user's machine) but DISABLED in HTTP
 * mode (a hosted server must not read arbitrary server paths).
 *
 * @author Dr Hamid MADANI <drmdh@msn.com>
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { diffSchemas, generateMigrationSQL, type EntitySchema } from '@mostajs/orm';
import { validateSchemas } from '@mostajs/orm/validator';

const VERSION = '0.1.0';
const TOOL_NAMES = ['mostajs_generate_schema', 'mostajs_validate', 'mostajs_create_migration'];

const FIELD_TYPES = ['string', 'text', 'number', 'boolean', 'date', 'json', 'array'] as const;
const RELATION_TYPES = ['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'] as const;
const ON_DELETE = ['cascade', 'set-null', 'restrict', 'no-action'] as const;

const fieldShape = z.object({
  name: z.string(),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  default: z.any().optional(),
});

const relationShape = z.object({
  name: z.string(),
  target: z.string(),
  type: z.enum(RELATION_TYPES),
  required: z.boolean().optional(),
  mappedBy: z.string().optional(),
  onDelete: z.enum(ON_DELETE).optional(),
});

type FieldInput = z.infer<typeof fieldShape>;
type RelationInput = z.infer<typeof relationShape>;

function buildSchema(input: {
  name: string;
  collection?: string;
  fields: FieldInput[];
  relations?: RelationInput[];
  timestamps?: boolean;
  softDelete?: boolean;
}): EntitySchema {
  const fields: Record<string, unknown> = {};
  for (const f of input.fields) {
    fields[f.name] = {
      type: f.type,
      ...(f.required ? { required: true } : {}),
      ...(f.unique ? { unique: true } : {}),
      ...(f.default !== undefined ? { default: f.default } : {}),
    };
  }
  const relations: Record<string, unknown> = {};
  for (const r of input.relations ?? []) {
    relations[r.name] = {
      target: r.target,
      type: r.type,
      ...(r.required ? { required: true } : {}),
      ...(r.mappedBy ? { mappedBy: r.mappedBy } : {}),
      ...(r.onDelete ? { onDelete: r.onDelete } : {}),
    };
  }
  return {
    name: input.name,
    collection: input.collection ?? `${input.name.toLowerCase()}s`,
    fields,
    relations,
    indexes: [],
    timestamps: input.timestamps ?? true,
    ...(input.softDelete ? { softDelete: true } : {}),
  } as unknown as EntitySchema;
}

function toTypeScript(schema: EntitySchema): string {
  return (
    `import type { EntitySchema } from '@mostajs/orm';\n\n` +
    `export const ${schema.name}Schema: EntitySchema = ${JSON.stringify(schema, null, 2)};\n`
  );
}

/**
 * Build a fresh McpServer with the three tools.
 * @param allowFsAccess  if false, `mostajs_validate.sourceRoot` is ignored
 *                       (hosted HTTP mode — never read the server's filesystem).
 */
function createServer(allowFsAccess: boolean): McpServer {
  const server = new McpServer({ name: 'mostajs-orm', version: VERSION });

  server.tool(
    'mostajs_generate_schema',
    'Generate a @mostajs/orm EntitySchema (TypeScript) from an entity name + fields (+ optional relations). Returns ready-to-paste TS and runs the 24-rule validator on the result.',
    {
      name: z.string().describe('Entity name in PascalCase, e.g. "Post"'),
      collection: z.string().optional().describe('Table/collection name; defaults to lowercased name + "s"'),
      fields: z.array(fieldShape).describe('Field definitions'),
      relations: z.array(relationShape).optional().describe('Relations to other entities'),
      timestamps: z.boolean().optional().describe('Auto-manage createdAt/updatedAt (default true)'),
      softDelete: z.boolean().optional().describe('Enable soft delete (deletedAt + auto-filter)'),
    },
    async (args) => {
      const schema = buildSchema(args);
      const report = await validateSchemas([schema]);
      const ts = toTypeScript(schema);
      const findings = report.findings.length
        ? report.findings.map((f) => `- [${f.severity}] ${f.ruleId}: ${f.message}`).join('\n')
        : '- none';
      return {
        content: [
          { type: 'text', text: `${ts}\n/* Validator — ${report.findings.length} finding(s):\n${findings}\n*/` },
        ],
      };
    },
  );

  server.tool(
    'mostajs_validate',
    'Lint one or more @mostajs/orm EntitySchemas with the built-in conceptual validator (24 rules). Pass schemas as JSON. (sourceRoot cross-file rules are only available in local/stdio mode.)',
    {
      schemas: z.array(z.any()).describe('Array of EntitySchema objects (JSON)'),
      sourceRoot: z.string().optional().describe('Project src root for cross-file rules — IGNORED on the hosted server'),
    },
    async ({ schemas, sourceRoot }) => {
      const useRoot = allowFsAccess && sourceRoot ? { sourceRoot } : undefined;
      const report = await validateSchemas(schemas as EntitySchema[], useRoot);
      const note =
        !allowFsAccess && sourceRoot
          ? '\n\n(note: sourceRoot was ignored — cross-file rules require the local stdio server)'
          : '';
      return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) + note }] };
    },
  );

  server.tool(
    'mostajs_create_migration',
    'Diff two sets of @mostajs/orm EntitySchemas and produce SQL migration statements (diffSchemas + generateMigrationSQL).',
    {
      oldSchemas: z.array(z.any()).describe('Previous EntitySchema[] (JSON) — [] for a fresh database'),
      newSchemas: z.array(z.any()).describe('Target EntitySchema[] (JSON)'),
    },
    async ({ oldSchemas, newSchemas }) => {
      const ops = diffSchemas(oldSchemas as EntitySchema[], newSchemas as EntitySchema[]);
      const sql = generateMigrationSQL(ops);
      return {
        content: [{ type: 'text', text: sql.length ? sql.join('\n') : '-- no schema changes detected' }],
      };
    },
  );

  return server;
}

// --- stdio transport (local) ------------------------------------------------
async function startStdio(): Promise<void> {
  const server = createServer(/* allowFsAccess */ true);
  await server.connect(new StdioServerTransport());
  // stdout is reserved for the protocol — log to stderr only.
  console.error(`@mostajs/orm-mcp v${VERSION} on stdio (tools: ${TOOL_NAMES.join(', ')})`);
}

// --- Streamable HTTP transport (hosted, e.g. orm-mcp.amia.fr) ----------------
async function startHttp(port: number): Promise<void> {
  const { default: express } = await import('express');
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Minimal CORS (lets browser-based MCP clients connect).
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, mcp-protocol-version');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Human/health endpoint.
  app.get('/', (_req, res) => {
    res.json({
      name: '@mostajs/orm-mcp',
      version: VERSION,
      transport: 'streamable-http',
      endpoint: '/mcp',
      tools: TOOL_NAMES,
      docs: 'https://mostajs.dev',
    });
  });

  // Stateless MCP endpoint: a fresh server + transport per request.
  app.post('/mcp', async (req, res) => {
    const server = createServer(/* allowFsAccess */ false);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
      }
    }
  });

  // Stateless server: no server-initiated streams / sessions.
  const notAllowed = (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server)' }, id: null });
  app.get('/mcp', notAllowed as never);
  app.delete('/mcp', notAllowed as never);

  app.listen(port, () => {
    console.error(`@mostajs/orm-mcp v${VERSION} on http://localhost:${port}/mcp (tools: ${TOOL_NAMES.join(', ')})`);
  });
}

// --- Boot -------------------------------------------------------------------
const httpMode = process.argv.includes('--http') || !!process.env.PORT;
if (httpMode) {
  await startHttp(Number(process.env.PORT) || 8930);
} else {
  await startStdio();
}
