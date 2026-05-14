---
name: n8n-workflow-designer
description: >
  Design, compile, and deploy n8n workflows from natural language descriptions.
  Transforms ideas into production-ready n8n automations using TypeScript decorators,
  SDK-normalized workflow JSON, validation, and the n8n REST API.
  
  Capabilities:
  - Natural language → workflow design (triggers, nodes, connections, error handling)
  - TypeScript code generation with @n8n-as-code/transformer decorators
  - Optional SDK-normalized JSON generation with @n8n/workflow-sdk
  - Compilation to n8n JSON format
  - Deployment to n8n instances with credential management and update-existing support
  - Workflow validation with idiomatic checks and official SDK validation
  
  Triggers on: n8n workflow, create automation, design workflow, deploy workflow,
  build n8n automation, workflow idea, n8n integration, Bitrix24 automation,
  schedule trigger, webhook automation, AI agent workflow.
---

# n8n Workflow Designer

Design, validate, compile, and deploy n8n workflows from natural language descriptions using the n8n-as-code TypeScript format and optional SDK-normalized JSON.

## Overview

This skill enables end-to-end n8n workflow creation:

```
Natural Language Idea → Workflow Design → TypeScript or SDK JSON → Validation → n8n JSON → Deployed Workflow
```

## Prerequisites

The companion MCP server includes the required packages:

- `@n8n-as-code/transformer` for decorator TypeScript compilation
- `@n8n/workflow-sdk` for SDK-normalized JSON and official validation
- `n8n-workflow` for official n8n workflow/node types

Deployment requires a running n8n instance:

```bash
export N8N_API_KEY="your-api-key"
export N8N_BASE_URL="https://your-n8n-instance.com"
```

## MCP Tool Usage

Use these tools in order for a safe workflow lifecycle:

1. `design_workflow` — create decorator TypeScript by default, or set `outputFormat` to `sdk-json` / `both`.
2. `compile_workflow` — compile decorator TypeScript to n8n JSON with `@n8n-as-code/transformer`.
3. `validate_workflow` — validate TypeScript idioms and run official SDK validation for complete JSON.
4. `deploy_workflow` — deploy JSON, updating an existing workflow by name unless `updateExisting: false`.
5. `list_workflows` / `get_workflow` — inspect deployed workflows.

`design_workflow.outputFormat`:

| Value | Use when |
|---|---|
| `decorator-typescript` | Humans or agents will review/edit the workflow. This is the default. |
| `sdk-json` | The caller wants SDK-normalized JSON directly. |
| `both` | You need reviewable TypeScript plus JSON for inspection. |

## Workflow Design Process

### Step 1: Understand Requirements

Before generating code, clarify:

1. **Trigger type**: webhook, schedule, manual, chat, telegram, email?
2. **Data sources**: Bitrix24, Google, Microsoft, database, API?
3. **Actions**: create, update, send, transform, notify?
4. **Error handling**: retry, alert, fallback?
5. **AI integration**: OpenAI, Gemini, local LLM?

### Step 2: Select Node Types

| Category | Node Type | Use Case |
|---|---|---|
| **Triggers** | `n8n-nodes-base.webhook` | HTTP endpoints |
| | `n8n-nodes-base.scheduleTrigger` | Cron jobs |
| | `n8n-nodes-base.manualTrigger` | One-click execution |
| | `n8n-nodes-base.telegramTrigger` | Telegram bot |
| | `@n8n/n8n-nodes-langchain.chatTrigger` | AI chat |
| **Bitrix24** | `n8n-nodes-base.bitrix24` | CRM leads, deals, contacts; prefer native credentials over webhook URLs |
| **Microsoft** | `n8n-nodes-base.microsoftOutlook` | Email |
| | `n8n-nodes-base.microsoftTeams` | Teams messages |
| **AI** | `@n8n/n8n-nodes-langchain.agent` | AI Agent |
| | `@n8n/n8n-nodes-langchain.lmChatOpenAi` | OpenAI |
| | `@n8n/n8n-nodes-langchain.lmChatOpenRouter` | OpenRouter |
| | `@n8n/n8n-nodes-langchain.googleGemini` | Gemini |
| **Logic** | `n8n-nodes-base.if` | Conditional branching |
| | `n8n-nodes-base.switch` | Multi-branch routing |
| | `n8n-nodes-base.merge` | Combine streams |
| | `n8n-nodes-base.set` | Set/edit fields and simple transforms |
| | `n8n-nodes-base.code` | Complex JavaScript only: loops, grouping, custom algorithms |
| **Data** | `n8n-nodes-base.httpRequest` | Generic HTTP |
| | `n8n-nodes-base.splitInBatches` | Batch processing |
| | `n8n-nodes-base.itemLists` | List operations |
| **Reliability** | `n8n-nodes-base.errorTrigger` | Error handling |
| | `n8n-nodes-base.wait` | Delay/polling |
| **Community** | `n8n-nodes-docxtemplater.docxtemplater` | DOCX generation from templates |
| | `@n8n/n8n-nodes-langchain.vectorStoreQdrant` | Qdrant vector retrieval for RAG workflows |

## Idiomatic n8n Design Guide

Use these rules before generating TypeScript or JSON. The companion MCP server validates against the same patterns.

### 1. Prefer Native Nodes Over `httpRequest`

Use `n8n-nodes-base.httpRequest` only when no maintained native or community node exists. Prefer native nodes for Bitrix24, Microsoft Teams, Telegram, Outlook, Google Sheets/Drive, Slack, and AI chat/agent work. External APIs without an n8n node may use `httpRequest`, but document why no native/community node applies.

### 2. Use Proper Credential References

Authenticated nodes must include a `credentials` object with placeholder IDs/names that match n8n credential types. Never hardcode API keys, webhook tokens, OAuth bearer tokens, or bot tokens in URLs or headers.

```typescript
@node({
    name: 'Notify Teams',
    type: 'n8n-nodes-base.microsoftTeams',
    credentials: {
        microsoftTeamsOAuth2Api: {
            id: 'MICROSOFT_TEAMS_CREDENTIAL_ID',
            name: 'Microsoft Teams account'
        }
    }
})
NotifyTeams = {
    resource: 'chatMessage',
    operation: 'create',
    teamId: '={{ $env.TEAMS_TEAM_ID }}',
    channelId: '={{ $env.TEAMS_CHANNEL_ID }}',
    message: '=Lead created: {{ $json.deal_title }}'
};
```

### 3. Generate `Set` Nodes for Simple Transforms

Use `n8n-nodes-base.set` for field mapping, renaming, static defaults, formatting expressions, and simple extraction. Use `Code` only for complex JavaScript: loops across `$input.all()`, grouping, sorting, algorithmic transforms, binary manipulation, or custom libraries.

### 4. Use the AI Agent Pattern With Sub-Nodes

AI workflows should use a main `@n8n/n8n-nodes-langchain.agent` node and sub-nodes for model, memory, tools, and vector stores. Do not call OpenAI/OpenRouter with raw HTTP for normal chat/agent behavior.

```typescript
@node({ name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent' })
Agent = { text: '={{ $json.summary }}' };

@node({
    name: 'OpenAI Model',
    type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
    credentials: { openAiApi: { id: 'OPENAI_CREDENTIAL_ID', name: 'OpenAI account' } }
})
OpenAIModel = {
    model: 'gpt-4o-mini'
};

@node({ name: 'Memory', type: '@n8n/n8n-nodes-langchain.memoryBufferWindow' })
Memory = { sessionKey: '={{ $execution.id }}', contextWindowLength: 10 };

@links()
defineRouting() {
    this.ChatTrigger.out(0).to(this.Agent.in(0));
    this.Agent.uses({
        ai_languageModel: this.OpenAIModel.output,
        ai_memory: this.Memory.output
    });
}
```

### 5. Include Error Workflow References

Production workflows should reference a separate error workflow in settings. The error workflow contains `n8n-nodes-base.errorTrigger` followed by a native notification node.

```typescript
@workflow({
    id: 'lead-router',
    name: 'Lead Router',
    active: false,
    settings: { executionOrder: 'v1', errorWorkflow: 'lead-router-errors' }
})
export class LeadRouterWorkflow {}
```

Do not place `errorTrigger` in the main workflow and assume it handles that workflow's own failures; n8n error triggers run as separate workflows.

### 6. Support Community Nodes Deliberately

Community/optional nodes are allowed when they are the idiomatic fit, but mark installation requirements:

- DOCX generation: `n8n-nodes-docxtemplater.docxtemplater` requires `n8n-nodes-docxtemplater` installed via Community Nodes.
- Qdrant/RAG: prefer `@n8n/n8n-nodes-langchain.vectorStoreQdrant` or the installed Qdrant community node with `qdrantApi` credentials.
- If a community node is unavailable in the target instance, fall back only after noting the tradeoff.

### 7. Validate Idiomatic Patterns

Run `validate_workflow` on generated TypeScript or compiled JSON. When complete JSON is provided, the MCP server also runs `@n8n/workflow-sdk` validation. Treat warnings as design feedback:

- `prefer-native-node` — raw `httpRequest` appears to call an integration with a native node.
- `missing-credential-reference` — authenticated node lacks credential placeholders.
- `prefer-set-node` — `Code` appears to do simple field mapping.
- `ai-agent-missing-model` / `ai-agent-sub-node-linking` — Agent lacks model/sub-node wiring.
- `missing-error-workflow-reference` — main workflow lacks `settings.errorWorkflow`.
- `community-node-requirement` — target instance must have the optional/community node installed.
- `sdk-*` — official SDK validation found a structural issue in complete workflow JSON.

### Step 3: Generate Workflow Output

Prefer decorator TypeScript for reviewable workflows. Use `outputFormat: 'sdk-json'` only when the caller needs JSON directly, and `outputFormat: 'both'` when comparing TypeScript and SDK-normalized JSON.

```json
{
    "description": "When a webhook receives a new lead, create a Bitrix24 lead and send a Telegram alert",
    "workflowName": "Lead Intake",
    "outputFormat": "decorator-typescript"
}
```

### Step 4: Generate TypeScript Code

Use the decorator pattern:

```typescript
import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
    id: 'unique-workflow-id',
    name: 'Workflow Name',
    active: false,
    settings: { executionOrder: 'v1' }
})
export class MyWorkflow {
    @node({
        id: 'node-1',
        name: 'Trigger',
        type: 'n8n-nodes-base.webhook',
        version: 1,
        position: [200, 300]
    })
    Trigger = {
        httpMethod: 'POST',
        path: 'my-webhook'
    };

    @node({
        id: 'node-2',
        name: 'Process Data',
        type: 'n8n-nodes-base.code',
        version: 1,
        position: [400, 300]
    })
    ProcessData = {
        jsCode: '// Transform data here'
    };

    @links()
    defineRouting() {
        this.Trigger.out(0).to(this.ProcessData.in(0));
    }
}
```

### Step 5: Compile to JSON

```typescript
import { TypeScriptParser, WorkflowBuilder } from '@n8n-as-code/transformer';

const parser = new TypeScriptParser();
const builder = new WorkflowBuilder();

const ast = await parser.parseFile('my-workflow.workflow.ts');
const workflowJson = builder.build(ast);
```

### Step 6: Deploy

```json
{
    "workflowJson": { "name": "Workflow Name", "nodes": [], "connections": {} },
    "activate": false,
    "updateExisting": true
}
```

Deploy strips read-only fields and filters settings before sending data to n8n. With `updateExisting: true` (the default), it updates a workflow with the same name via `PATCH`; use `updateExisting: false` to always create a new workflow.

## Design Patterns

### Pattern 1: Webhook → Guard → Action

```typescript
@workflow({ id: 'webhook-guard', name: 'Secure Webhook Handler' })
export class SecureWebhookWorkflow {
    @node({ name: 'Webhook', type: 'n8n-nodes-base.webhook' })
    Webhook = { httpMethod: 'POST', path: 'secure-endpoint' };

    @node({ name: 'Auth Guard', type: 'n8n-nodes-base.if' })
    AuthGuard = {
        conditions: {
            boolean: [{
                value1: "={{ $json.headers['x-api-key'] === $env.WEBHOOK_API_KEY }}",
                value2: true
            }]
        }
    };

    @node({ name: 'Prepare Payload', type: 'n8n-nodes-base.set' })
    PreparePayload = {
        mode: 'manual',
        duplicateItem: false,
        assignments: {
            assignments: [
                { id: 'payload', name: 'payload', value: '={{ $json.body }}', type: 'object' }
            ]
        }
    };

    @node({
        name: 'Error Alert',
        type: 'n8n-nodes-base.telegram',
        credentials: { telegramApi: { id: 'TELEGRAM_CREDENTIAL_ID', name: 'Telegram Bot' } }
    })
    ErrorAlert = {
        operation: 'sendMessage',
        chatId: '={{ $env.TG_ERROR_CHAT_ID }}',
        text: '=Auth failed'
    };

    @links()
    defineRouting() {
        this.Webhook.out(0).to(this.AuthGuard.in(0));
        this.AuthGuard.out(0).to(this.PreparePayload.in(0));
        this.AuthGuard.out(1).to(this.ErrorAlert.in(0));
    }
}
```

### Pattern 2: Schedule → Fetch → AI → Notify

```typescript
@workflow({ id: 'scheduled-ai', name: 'Scheduled AI Report' })
export class ScheduledAiWorkflow {
    @node({ name: 'Schedule', type: 'n8n-nodes-base.scheduleTrigger' })
    Schedule = { rule: { interval: [{ field: 'hours', interval: 24 }] } };

    @node({ name: 'Fetch Data', type: 'n8n-nodes-base.httpRequest' })
    FetchData = { method: 'GET', url: 'https://api.example.com/data' };

    @node({ name: 'AI Analysis', type: '@n8n/n8n-nodes-langchain.agent' })
    AiAnalysis = {
        text: '=Analyze this data and return a short report: {{ JSON.stringify($json) }}'
    };

    @node({
        name: 'OpenAI Model',
        type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
        credentials: { openAiApi: { id: 'OPENAI_CREDENTIAL_ID', name: 'OpenAI account' } }
    })
    OpenAIModel = {
        model: 'gpt-4o-mini'
    };

    @node({
        name: 'Send Report',
        type: 'n8n-nodes-base.microsoftTeams',
        credentials: { microsoftTeamsOAuth2Api: { id: 'MICROSOFT_TEAMS_CREDENTIAL_ID', name: 'Microsoft Teams account' } }
    })
    SendReport = {
        resource: 'chatMessage',
        operation: 'create',
        teamId: '={{ $env.TEAMS_TEAM_ID }}',
        channelId: '={{ $env.TEAMS_CHANNEL_ID }}',
        message: '=AI report: {{ $json.output }}'
    };

    @links()
    defineRouting() {
        this.Schedule.out(0).to(this.FetchData.in(0));
        this.FetchData.out(0).to(this.AiAnalysis.in(0));
        this.AiAnalysis.out(0).to(this.SendReport.in(0));
        this.AiAnalysis.uses({ ai_languageModel: this.OpenAIModel.output });
    }
}
```

### Pattern 3: AI Agent with Tools

```typescript
@workflow({ id: 'ai-agent', name: 'AI Agent with Tools' })
export class AiAgentWorkflow {
    @node({ name: 'Chat', type: '@n8n/n8n-nodes-langchain.chatTrigger' })
    Chat = {};

    @node({ name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent' })
    Agent = {};

    @node({
        name: 'OpenAI',
        type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
        credentials: { openAiApi: { id: 'OPENAI_CREDENTIAL_ID', name: 'OpenAI' } }
    })
    OpenAI = { model: 'gpt-4o-mini' };

    @node({ name: 'Memory', type: '@n8n/n8n-nodes-langchain.memoryBufferWindow' })
    Memory = {};

    @node({ name: 'Weather Tool', type: 'n8n-nodes-base.httpRequestTool' })
    WeatherTool = { url: 'https://api.open-meteo.com/v1/forecast' };

    @links()
    defineRouting() {
        this.Chat.out(0).to(this.Agent.in(0));
        this.Agent.uses({
            ai_languageModel: this.OpenAI.output,
            ai_memory: this.Memory.output,
            ai_tool: [this.WeatherTool.output]
        });
    }
}
```

## Security Best Practices

1. **Never hardcode secrets** — Use n8n credentials or environment variables
2. **Validate inputs** — Use `if` nodes for routing and `set` nodes for safe field shaping; reserve `code` for complex validation
3. **PII masking** — Strip personal data before sending to AI services
4. **Error handling** — Always include `errorTrigger` nodes for critical workflows
5. **Rate limiting** — Add `wait` nodes for API polling

## Deployment Checklist

- [ ] Workflow compiles without errors
- [ ] All credentials configured in n8n UI
- [ ] Placeholder URLs replaced with real endpoints
- [ ] Error handling tested
- [ ] Webhook paths are unique
- [ ] Schedule intervals are appropriate
- [ ] Workflow tested in inactive mode first

## Common Issues

| Error | Cause | Solution |
|-------|-------|----------|
| `request/body/id is read-only` | Including `id` in POST | Remove `id` field before deploy |
| `request/body/active is read-only` | Including `active` in POST | Remove `active` field before deploy |
| `settings must NOT have additional properties` | Extra settings fields | Filter to allowed settings only |
| `credentials not found` | Missing credential in n8n | Create credential in n8n UI first |
| `webhook path already exists` | Duplicate webhook path | Use unique paths per workflow |

## Integration with MCP Server

This skill works with the companion MCP server (`n8n-workflow-mcp`) which exposes:

- `design_workflow` — Generate workflow design from description
- `compile_workflow` — Compile TypeScript to n8n JSON
- `deploy_workflow` — Deploy to n8n instance
- `list_workflows` — List deployed workflows
- `validate_workflow` — Check workflow structure and idiomatic n8n patterns

## Examples

### Example 1: Bitrix24 Lead Creation

```typescript
@workflow({ id: 'bitrix-lead', name: 'Create Bitrix24 Lead' })
export class BitrixLeadWorkflow {
    @node({ name: 'Webhook', type: 'n8n-nodes-base.webhook' })
    Webhook = { httpMethod: 'POST', path: 'new-lead' };

    @node({ name: 'Prepare Lead', type: 'n8n-nodes-base.set' })
    PrepareLead = {
        mode: 'manual',
        duplicateItem: false,
        assignments: {
            assignments: [
                { id: 'title', name: 'title', value: '={{ $json.body.name }}', type: 'string' },
                { id: 'phone', name: 'phone', value: '={{ $json.body.phone }}', type: 'string' }
            ]
        }
    };

    @node({
        name: 'Create Lead',
        type: 'n8n-nodes-base.bitrix24',
        credentials: { bitrix24OAuth2Api: { id: 'BITRIX24_CREDENTIAL_ID', name: 'Bitrix24 account' } }
    })
    CreateLead = {
        resource: 'lead',
        operation: 'create',
        fields: { TITLE: '={{ $json.title }}', PHONE: [{ VALUE: '={{ $json.phone }}' }] }
    };

    @links()
    defineRouting() {
        this.Webhook.out(0).to(this.PrepareLead.in(0));
        this.PrepareLead.out(0).to(this.CreateLead.in(0));
    }
}
```

### Example 2: Document OCR Pipeline

```typescript
@workflow({ id: 'ocr-pipeline', name: 'Document OCR' })
export class OcrWorkflow {
    @node({ name: 'Upload', type: 'n8n-nodes-base.webhook' })
    Upload = { httpMethod: 'POST', path: 'upload-doc' };

    @node({ name: 'Validate File Type', type: 'n8n-nodes-base.if' })
    ValidateFileType = {
        conditions: {
            conditions: [{ leftValue: '={{ $json.body.fileType }}', rightValue: 'pdf|jpg|png', operator: { type: 'string', operation: 'regex' } }],
            combinator: 'and'
        }
    };

    @node({ name: 'OCR', type: '@n8n/n8n-nodes-langchain.googleGemini' })
    Ocr = { model: 'gemini-pro-vision' };

    @node({ name: 'Save', type: 'n8n-nodes-base.httpRequest' })
    Save = {
        method: 'POST',
        url: 'https://api.example.com/save',
        jsonBody: '={"text": "{{$json.content}}"}'
    };

    @links()
    defineRouting() {
        this.Upload.out(0).to(this.ValidateFileType.in(0));
        this.ValidateFileType.out(0).to(this.Ocr.in(0));
        this.Ocr.out(0).to(this.Save.in(0));
    }
}
```

## Resources

- [n8n-as-code Transformer](https://github.com/EtienneLescot/n8n-as-code)
- [n8n REST API Docs](https://docs.n8n.io/api/)
- [n8n Node Reference](https://docs.n8n.io/integrations/builtin/)
