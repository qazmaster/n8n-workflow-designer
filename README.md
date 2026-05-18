# n8n Workflow Designer

OpenCode skill + MCP server for designing, validating, compiling, and deploying idiomatic n8n workflows from natural language descriptions, with optional live n8n node intelligence from `czlonkowski/n8n-mcp`.

The default authoring format is readable TypeScript decorators. The MCP server can also return SDK-normalized workflow JSON using the official `@n8n/workflow-sdk` for callers that want JSON directly.

## What this tool does

```text
Natural language idea
→ examples/templates and node metadata lookup
→ idiomatic workflow design
→ decorator TypeScript or SDK-normalized JSON
→ node and workflow validation
→ compiled n8n workflow JSON
→ deployed workflow in n8n
```

Use it when you want an AI agent to create or maintain n8n automations while still producing reviewable workflow artifacts.

## Components

### OpenCode skill

The bundled `n8n-workflow-designer` skill teaches the agent how to design idiomatic n8n workflows. It covers native node selection, credential placeholders, AI Agent sub-node wiring, error workflows, community node requirements, and validation expectations.

The skill now uses a two-layer MCP architecture:

- **Workflow lifecycle layer** — this repository's MCP server owns reviewable workflow artifacts, design, compile, validation, deploy, execution, import/export, and workflow inspection.
- **n8n intelligence layer** — an already-installed `czlonkowski/n8n-mcp` server owns live node discovery, schemas, operations, docs, examples/templates, and node-level validation.

Install it into your OpenCode/Claude skills directory:

```bash
cp -r skills/n8n-workflow-designer ~/.claude/skills/
```

### MCP server

This repository's MCP server exposes workflow lifecycle tools:

| Tool | Purpose |
|---|---|
| `design_workflow` | Generate workflow TypeScript, SDK JSON, or both from natural language. |
| `compile_workflow` | Compile decorator TypeScript into n8n workflow JSON with `@n8n-as-code/transformer`. |
| `validate_workflow` | Check idiomatic rules and run official SDK validation for complete JSON. |
| `deploy_workflow` | Create or update a workflow through the n8n REST API, including explicit update-by-ID and dry-run modes. |
| `execute_workflow` | Manually execute a workflow and optionally poll execution status. |
| `export_workflow` | Fetch portable workflow JSON by ID. |
| `import_workflow` | Import workflow JSON using the same safe deployment semantics. |
| `list_credentials` | List credential metadata for resolving placeholders; secret payloads are redacted. |
| `list_community_packages` | List installed community packages in the target n8n instance. |
| `list_workflows` | List workflows in the configured n8n instance. |
| `get_workflow` | Fetch one workflow by ID. |

### n8n intelligence MCP

When `czlonkowski/n8n-mcp` is installed in the MCP client settings, the skill uses it as the live n8n reference layer before and during lifecycle operations:

| Tool | Purpose |
|---|---|
| `tools_documentation` | Discover available n8n-mcp tools and recommended lookup modes. |
| `search_templates` | Find reusable workflow templates and common automation patterns. |
| `get_template` | Inspect a selected template before adapting its structure. |
| `search_nodes` | Find native or community nodes by capability or integration name. |
| `get_node` | Inspect node schemas, parameters, operations, docs, examples, and versions. |
| `validate_node` | Validate configured nodes against live metadata. |
| `validate_workflow` | Cross-check workflow configuration against n8n metadata. |

The intelligence MCP is not a replacement for this repository's lifecycle MCP server. It improves node correctness and pattern discovery; artifact generation, compilation, deployment safeguards, and execution remain lifecycle responsibilities.

### Example workflows

The examples demonstrate OCR, Bitrix24, document generation, reporting, monitoring, meeting processing, AI agents, Telegram/Google workflows, and large-document OCR patterns.

### Batch deploy script

The deployment script compiles local `.workflow.ts` files and deploys them to n8n. It is useful for batch example deployment; the MCP server is better for agent-driven design/compile/validate/deploy loops.

## Package roles

| Package | Role |
|---|---|
| `@n8n-as-code/transformer` | Decorator TypeScript ⇄ n8n workflow JSON compilation. |
| `@n8n/workflow-sdk` | Official SDK JSON normalization and workflow validation. |
| `n8n-workflow` | Official n8n workflow and node types. |
| `n8nac` | Workflow-as-code CLI tooling for development workflows. |
| `@n8n/cli` | Official n8n CLI tooling for workflow/execution/credential operations. |

The MCP server also mirrors useful n8n public API surfaces directly: workflow update-by-ID, execution, import/export, credential metadata, and community package discovery. These calls use `N8N_API_KEY` and `N8N_BASE_URL` and do not require embedding the full `n8n` runtime.

`czlonkowski/n8n-mcp` complements those lifecycle calls with a searchable n8n knowledge base. Use it to avoid invented node names, invalid operations, stale parameters, and missed template patterns.

## Safer deployment modes

`deploy_workflow` and `import_workflow` support three strategies:

| Mode | Behavior |
|---|---|
| `upsert-by-name` | Default. Find an existing workflow by name and `PATCH`, otherwise `POST` a new workflow. |
| `update-by-id` | `PATCH /api/v1/workflows/{workflowId}`. This is preferred for production-safe updates. |
| `create` | Always `POST /api/v1/workflows`; equivalent to `updateExisting: false`. |

Set `dryRun: true` to inspect the sanitized payload and selected strategy without mutating the n8n instance or requiring `N8N_API_KEY`. Mutating deploy/import calls require `confirmMutation: true` so generated workflows are not created, updated, or activated accidentally.

## Validation registry

`validate_workflow` now runs a local known-node registry by default. It checks common credential requirements, community package requirements, and lightweight required parameters such as `httpRequest.url`. Full n8n node schema validation remains intentionally disabled until node description directories are wired into `@n8n/workflow-sdk`.

For full live node schema, operation, and property checks, use `czlonkowski/n8n-mcp` alongside the local registry. The intended validation path is: inspect templates and nodes with n8n-mcp, validate configured nodes with n8n-mcp, then run this repository's lifecycle `validate_workflow` before compile/deploy.

The full `n8n` package is intentionally not embedded. This project talks to a running n8n instance through the API.

## Prerequisites

- Node.js 18+
- A running n8n instance with API access
- An n8n API key
- OpenCode/Claude Code or another MCP-capable client

Set environment variables before running deployment tools:

```bash
export N8N_API_KEY="your-api-key"
export N8N_BASE_URL="https://your-n8n-instance.com"
```

## Setup

```bash
cd mcp-server
npm install
npm run build
npm start
```

The server runs over stdio, so most users start it through their MCP client configuration rather than calling it directly from a shell.

## Typical workflow

### 0. Discover templates and nodes

Before designing a non-trivial workflow, use the installed `czlonkowski/n8n-mcp` intelligence layer:

```text
search_templates → get_template → search_nodes → get_node → validate_node
```

Use template results for best-practice workflow structure and `get_node` results for exact node type, version, operation, parameter, credential, and expression guidance. If the intelligence layer is unavailable, proceed with reduced confidence and rely on this repository's local validation registry.

### 1. Design a workflow

Ask this repository's lifecycle MCP server to design from natural language:

```json
{
  "description": "When a webhook receives a new lead, create a Bitrix24 lead and send a Telegram alert",
  "workflowName": "Lead Intake",
  "includeErrorHandling": true,
  "preferredNotificationChannel": "telegram"
}
```

By default, `design_workflow` returns decorator TypeScript using `@n8n-as-code/transformer`.

### 2. Choose the output format

`design_workflow` supports three output modes:

| `outputFormat` | Result |
|---|---|
| `decorator-typescript` | Reviewable TypeScript decorators. This is the default. |
| `sdk-json` | n8n workflow JSON normalized through `@n8n/workflow-sdk`. |
| `both` | Decorator TypeScript plus an SDK-normalized JSON block for inspection. |

Example JSON output request:

```json
{
  "description": "Manual trigger, prepare data, then notify Telegram",
  "workflowName": "Simple Notify",
  "outputFormat": "sdk-json"
}
```

Use `decorator-typescript` when humans or agents will review and edit the workflow. Use `sdk-json` when a caller wants deployable JSON without a separate compile step.

### 3. Compile TypeScript to JSON

If you designed decorator TypeScript, compile it:

```json
{
  "typescriptCode": "import { workflow, node, links } from '@n8n-as-code/transformer';\n..."
}
```

You can also compile a file path:

```json
{
  "filePath": "examples/idiomatic-workflows/case1-ocr-vcard.idiomatic.workflow.ts"
}
```

Temporary compile files are cleaned up immediately after compilation.

### 4. Validate before deployment

Run `validate_workflow` on either TypeScript or compiled JSON:

```json
{
  "workflowJson": {
    "name": "Simple Notify",
    "nodes": [],
    "connections": {}
  }
}
```

Validation combines project-specific idiomatic checks with official SDK validation when complete workflow JSON is provided. For exact node schemas and operation-level metadata, validate configured nodes with `czlonkowski/n8n-mcp` before this lifecycle validation step.

Common feedback includes:

- prefer native nodes over raw HTTP requests
- add missing credential placeholders
- prefer Set nodes for simple field transforms
- wire AI Agent model/memory/tool sub-nodes correctly
- declare a separate `settings.errorWorkflow`
- install required community nodes before deployment

### 5. Deploy to n8n

Deploy compiled JSON or SDK JSON:

```json
{
  "workflowJson": {
    "name": "Lead Intake",
    "nodes": [],
    "connections": {},
    "settings": { "executionOrder": "v1" }
  },
  "activate": false,
  "updateExisting": true
}
```

Deployment behavior:

- `updateExisting` defaults to `true`.
- When a workflow with the same name exists, the server updates it with `PATCH`.
- When no workflow matches, the server creates it with `POST`.
- Set `updateExisting: false` to always create a new workflow.
- Read-only fields such as `id`, `active`, `tags`, and timestamps are stripped before deploy.
- Settings are filtered to n8n API-safe fields before deploy.

For production automation, prefer unique workflow names or explicit workflow IDs to avoid accidental name collisions.

## Idiomatic design principles

1. **Templates before invention** — search examples/templates with `czlonkowski/n8n-mcp` before designing common automation patterns.
2. **Native nodes over HTTP Request** — use nodes such as Bitrix24, Telegram, Microsoft Teams, Outlook, Google Sheets, and Google Drive before raw HTTP.
3. **Schema-backed configuration** — inspect selected nodes with `get_node` and validate important configurations with `validate_node`.
4. **Credential references** — configure credentials in n8n and reference placeholder IDs/names; never hardcode secrets.
5. **Set nodes for simple transforms** — use Code only for loops, grouping, custom algorithms, binary work, or complex JavaScript.
6. **AI Agent pattern** — use `@n8n/n8n-nodes-langchain.agent` plus model, memory, tool, and vector-store sub-nodes.
7. **Error workflows** — create a separate Error Trigger workflow and reference it through `settings.errorWorkflow`.
8. **Sub-workflows** — reuse shared logic with `executeWorkflow`.
9. **Community nodes deliberately** — document required community nodes such as docxtemplater or Qdrant before deployment.

## Credential handling

Generated workflows use credential placeholders like this:

```typescript
@node({
    name: 'Send Telegram Alert',
    type: 'n8n-nodes-base.telegram',
    credentials: {
        telegramApi: {
            id: 'TELEGRAM_CREDENTIAL_ID',
            name: 'Telegram Bot'
        }
    }
})
TelegramAlert = {
    operation: 'sendMessage',
    chatId: '={{ $env.TG_ERROR_CHAT_ID }}',
    text: '=n8n update: {{ $json.summary }}'
};
```

Replace placeholder IDs with credential IDs from the target n8n instance before deployment.

## Testing and verification

```bash
cd mcp-server
npm run build
npm test
```

The integration tests cover:

- decorator TypeScript generation and compilation
- SDK-normalized JSON output
- official SDK validation
- update-existing, update-by-ID, dry-run, confirmation-gated deploy behavior, and deploy settings filtering
- execution endpoint calls
- export/import lifecycle helpers
- credential metadata redaction and community package listing
- API error-body redaction for sensitive keys
- known-node registry validation
- skill documentation for the two-layer lifecycle/intelligence architecture

## Security notes

- Keep `N8N_API_KEY` out of workflow JSON and source-controlled files.
- Treat auto-deploy as privileged; generated workflows can call external services if allowed nodes are present.
- Use human review or node allowlists before deploying workflows generated from untrusted prompts.
- Prefer `workflowId` / `mode: "update-by-id"` for production updates. Name-based upserts are convenient but less safe.
- Use `dryRun: true` first, then set `confirmMutation: true` only when the target instance and payload have been reviewed.
- `execute_workflow` also requires `confirmMutation: true` because running a workflow can send messages, update CRMs, or call external APIs.
- Run dependency audits before production releases.

## License

MIT
