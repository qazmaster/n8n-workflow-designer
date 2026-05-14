# n8n Workflow Designer

OpenCode skill + MCP server for designing, compiling, and deploying idiomatic n8n workflows from natural language descriptions.

## Overview

```
Natural Language Idea → Workflow Design → TypeScript Code → n8n JSON → Deployed Workflow
```

## Components

### 1. OpenCode Skill (`skills/n8n-workflow-designer/`)

Provides design guidance, idiomatic patterns, and node reference for n8n workflow creation.

**Installation:**
```bash
# Copy skill to your OpenCode skills directory
cp -r skills/n8n-workflow-designer ~/.claude/skills/
```

**Features:**
- Idiomatic n8n design patterns (native nodes over HTTP Request)
- Credential management best practices
- AI Agent + sub-node patterns
- Error workflow references
- Community node support (docxtemplater, Qdrant, etc.)

### 2. MCP Server (`mcp-server/`)

Model Context Protocol server exposing tools for workflow lifecycle management.

**Tools:**
- `design_workflow` — Generate idiomatic TypeScript from natural language
- `compile_workflow` — Compile TypeScript to n8n JSON
- `deploy_workflow` — Deploy to n8n instance via REST API
- `validate_workflow` — Check idiomatic patterns and common issues
- `list_workflows` / `get_workflow` — Management operations

**Setup:**
```bash
cd mcp-server
npm install
npm run build

# Set environment variables
export N8N_API_KEY="your-api-key"
export N8N_BASE_URL="https://your-n8n-instance.com"

# Start server
npm start
```

### 3. Example Workflows (`examples/idiomatic-workflows/`)

9 redesigned idiomatic workflows demonstrating best practices:

| Workflow | Description |
|----------|-------------|
| `case1-ocr-vcard` | OCR business card capture with auth guard |
| `case2-voice-tasks` | Voice note transcription and task routing |
| `case3-reporting` | Bi-weekly deal reporting with AI analysis |
| `case4-documents` | NDA/document generation pipeline |
| `case5-monitor` | Daily deal monitoring with alerts |
| `case6-meetings` | Meeting transcript processing |
| `build-your-first-ai-agent` | AI agent with tools demo |
| `personal-life-manager` | Telegram + Google services integration |
| `process-large-documents-ocr` | SubworkflowAI + Gemini OCR |

### 4. Deployment Script (`scripts/deploy_workflows.js`)

Batch deployment script for `.workflow.ts` files:

```bash
N8N_API_KEY="your-key" node scripts/deploy_workflows.js
```

## Idiomatic Design Principles

1. **Native nodes over HTTP Request** — Use `bitrix24`, `telegram`, `microsoftTeams` instead of raw HTTP
2. **Credential references** — Configure in n8n UI, reference by ID
3. **Set nodes for transforms** — Replace simple `code` nodes with `set`
4. **AI Agent pattern** — Use `@n8n/n8n-nodes-langchain.agent` + sub-nodes
5. **Error workflows** — Dedicated error handlers referenced via `settings.errorWorkflow`
6. **Sub-workflows** — Reusable logic via `executeWorkflow`

## Prerequisites

- Node.js 18+
- n8n instance with API access
- OpenCode/Claude Code with skill support

## License

MIT
