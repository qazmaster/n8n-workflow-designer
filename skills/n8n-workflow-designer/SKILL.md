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
  - Deployment to n8n instances with credential management, update-by-ID, dry-run, and update-existing support
  - Workflow execution, import/export, credential metadata, and community package discovery
  - Workflow validation with idiomatic checks, official SDK validation, and known-node registry checks
  
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

## Prerequisites & Deployment Modes

The companion MCP server includes the required packages:

- `@n8n-as-code/transformer` for decorator TypeScript compilation
- `@n8n/workflow-sdk` for SDK-normalized JSON and official validation
- `n8n-workflow` for official n8n workflow/node types

The server operates in one of two modes depending on the `N8N_DESIGNER_DEPLOY_MODE` (or `DEPLOY_MODE`) environment variable:

### 1. Standalone Mode (`standalone` - Default)
Direct mutation and query tools (`deploy_workflow`, `execute_workflow`, `import_workflow`, `export_workflow`, `list_workflows`, `get_workflow`, `list_credentials`, `list_community_packages`) call the n8n API directly. This requires:
```bash
export N8N_API_KEY="your-api-key"
export N8N_BASE_URL="https://your-n8n-instance.com"
```

### 2. Delegated Mode (`delegated`)
Direct mutations are blocked. Instead, the server operates completely offline to compile, sanitize, and validate workflows, returning structured migration and execution plans.
- **Remote / Hosted Backend Support**: The target `n8n-mcp` backend can be local, remote self-hosted, or hosted. `n8n-workflow-designer` does not make any direct HTTP calls to the backend or require local installation of `czlonkowski/n8n-mcp`. The AI client executes all commands via its own configured `n8n-mcp` tools.
- **No Credentials Required**: In delegated mode, `N8N_API_KEY` and `N8N_BASE_URL` are not required by `n8n-workflow-designer`.
- **Halt Check (CRITICAL)**: Before calling any recommended tool returned by `prepare_*_plan` (e.g. `n8n_list_workflows`, `n8n_create_workflow`, `n8n_update_full_workflow`, `n8n_test_workflow`, or `n8n_get_workflow`), the AI agent **MUST** check if those tools are configured and available in its client MCP tool list. If these tools are not available, the agent **MUST STOP IMMEDIATELY** and ask the user to connect or configure the `n8n-mcp` server.

## MCP Tool Usage

Use these tools in order for a safe workflow lifecycle:

1. `design_workflow` — create decorator TypeScript by default, or set `outputFormat` to `sdk-json` / `both`.
2. `compile_workflow` — compile decorator TypeScript to n8n JSON with `@n8n-as-code/transformer`.
3. `validate_workflow` — validate TypeScript idioms and run official SDK validation for complete JSON. Additionally, execute the self-contained universal validator (using the Python validator code block provided at the end of this document) to detect version-specific configuration regressions.
4. `deploy_workflow` — deploy JSON. Prefer `workflowId` or `mode: "update-by-id"` for production-safe updates; use `dryRun: true` before mutating shared instances, then set `confirmMutation: true` for the actual create/update/activate call.
5. `execute_workflow` — run a deployed workflow manually and optionally poll execution status. Requires `confirmMutation: true` because execution can trigger external side effects.
6. `export_workflow` / `import_workflow` — move portable workflow JSON in and out of n8n.
7. `list_credentials` / `list_community_packages` — resolve credential placeholders and verify optional node availability.
8. `list_workflows` / `get_workflow` — inspect deployed workflows.

`design_workflow.outputFormat`:

| Value | Use when |
|---|---|
| `decorator-typescript` | Humans or agents will review/edit the workflow. This is the default. |
| `sdk-json` | The caller wants SDK-normalized JSON directly. |
| `both` | You need reviewable TypeScript plus JSON for inspection. |

## Three-Layered TDD Model (Test-Driven Development)

The designer implements a **Three-Layered TDD Model** that separates testing specifications and mocks from production code:

*   **Level 1 — Design Contract TDD**: Create a declarative test contract defining expected paths (e.g. from trigger to action nodes), expected node outputs, and forbidden credential rules (e.g. preventing hardcoded tokens).
*   **Level 2 — Offline Structural TDD**: Statically validate the compiled workflow JSON against the contract policies, and generate localized Vitest/Jest `.test.ts` test suite files for offline pipeline runs.
*   **Level 3 — Sandbox Integration TDD & Repair Loop**: Deploy a sandbox test clone and execute runtime integration tests directly on the live n8n instance, evaluate outcomes, run an automated repair loop for expression/credential issues, and safely promote passing workflows to production.

### TDD & Sandbox Execution Pipeline
To build and verify a workflow using sandbox-guided TDD, execute the following pipeline:

```
Contract (generate_test_contract)
   ↓
Compile (compile_workflow)
   ↓
Static Validation (validate_workflow_against_contract)
   ↓
Sandbox Deploy (prepare_sandbox_deploy_plan)
   ↓
Manual/Test Execution (prepare_execution_suite)
   ↓
Execution Result Evaluation (evaluate_execution_result)
   ↓
Repair Loop (prepare_repair_patch) [if failed]
   ↓
Production Promotion (prepare_promotion_plan)
   ↓
Sandbox Cleanup (prepare_cleanup_plan)
```

### Sandbox TDD Tools

#### 1. `prepare_sandbox_deploy_plan`
Prepares a sandbox deployment plan. Under delegated mode, returns tool recommendations (e.g. `n8n_create_workflow` or `n8n_update_full_workflow`) to deploy an isolated sandbox test clone.
- **Rules**:
  - Name overrides: Always prefixes the workflow name with `[TEST]` and appends a suffix like `_sandbox` (or user specified `sandboxSuffix`).
  - Active status: Always sets `active: false` (deployed clone is inactive).
  - Tags: Automatically adds tags `["ai-generated", "test", "do-not-use-production"]` to prevent execution in production.

#### 2. `prepare_execution_suite`
Generates a suite of test case execution plans mapping the contract's inputs to run on the sandbox clone via n8n's `n8n_test_workflow` tool. Returns a set of assertions to evaluate against the logs.

#### 3. `prepare_repair_patch`
If execution fails, analyze the live run logs via `prepare_repair_patch`. It uses heuristics to diagnose errors:
- **Missing Parameters / Invalid Expressions**: Sniffs out undefined parameter references and suggests path adjustments (e.g. `{{ $json.nested.property }}` vs `{{ $json.property }}`).
- **Credential Errors**: Detects auth/API key errors, prompting credential checks.
Returns a structured diagnosis detailing the failing node, error class, observed input shape, expected expression, suspected cause, recommended patch, retest required status, and auto-repair allowance.

#### 4. `apply_repair_patch`
Programmatically applies a recommended patch containing a specific node and dotted parameter path modification directly to the workflow JSON.

#### 5. `prepare_retest_plan`
Generates a delegated update and retest plan (e.g., calling `n8n_update_full_workflow`) to redeploy the patched workflow JSON to the sandbox clone before re-running the execution test suite.

#### 6. `prepare_promotion_plan`
Promotes the sandbox workflow to a production workflow (either creating it or updating an existing one) if and only if all **Quality Gates** pass.
- **Quality Gates** (must be `'passed'`):
  - `staticValidation`: Static contract constraints check.
  - `sandboxExecutions`: Live executions on sandbox pass successfully.
  - `credentialPolicy`: Verification that credentials are not hardcoded.
  - `noTestArtifacts`: Verification that no mock test nodes or temporary nodes are in the design.
- **Sanitization**: Strips out the `[TEST]` prefix, `_sandbox` suffix, sets `active: true` (or user configuration), and removes test tags before returning the production deployment plan.

#### 7. `prepare_cleanup_plan`
Builds a cleanup plan containing the delete commands (e.g., calling `n8n_delete_workflow`) to remove the sandbox test clone from n8n.

#### 8. `evaluate_repair_scope`
Evaluates the severity/level of repairs required for a failing execution run:
- **Level 1 (Patch)**: Minor in-place parameters/expressions corrections. Auto-apply allowed.
- **Level 2 (Refactor)**: Structural fixes (adding data validation nodes, normalization Set nodes, error-handling subflows). Auto-apply allowed with report.
- **Level 3 (Redesign)**: Architectural misalignment (changing trigger types, splitting workflows, rate limiting or authentication issue, or 3+ failed repair attempts). Triggers redesign proposals.

#### 9. `prepare_refactor_plan`
Generates a structural refactoring plan to improve robustness or insert validation nodes. Recommends calling `design_workflow` with specific descriptions.

#### 10. `prepare_redesign_plan`
Generates an architectural redesign proposal when escalation triggers are hit (e.g. changing trigger model, re-authorizing). Outlines old vs new approaches, workflows list, migration impacts (e.g. new webhook url, credential requirements), and flags user approval.

#### 11. `generate_workflow_variant`
Programmatically generates modified sandbox workflow clone variants applying changes (e.g., replacing nodes, adding nodes, or changing trigger types).

#### 12. `compare_workflow_variants`
Detects and lists structural/parameter differences (added/removed nodes, modified parameters) between two workflow configurations.

#### 13. `prepare_migration_plan`
Prepares a step-by-step production migration and rollback checklist for redesigned workflow variants.

### Runtime-TDD Mode Guidelines

1. Never assume static validation is enough.
2. After sandbox deploy, run execution tests through n8n-mcp.
3. Always read execution result before proposing fixes.
4. Convert execution failure into structured diagnosis.
5. Generate minimal repair patch.
6. Apply patch only to workflow artifact or sandbox clone.
7. Re-run validation and sandbox execution.
8. Stop after repair budget is exhausted.
9. Never mutate or activate production automatically.
10. Promotion to production requires passed static validation, passed sandbox executions, no test artifacts, and explicit confirmation.

### Auto-Repair Safety Policy

- **Allowed fixes**: expression path fixes, Set node normalization, IF/Switch condition correction, missing field mapping, node parameter correction, connection/branch fixes, retry/error branch additions.
- **Forbidden without confirmation**: adding real credentials, changing production workflow, activating workflow, deleting nodes with external effects, changing external API targets, replacing business logic, sending real messages/payments/CRM actions.

> [!IMPORTANT]
> **Decoupled test overlay rule**: Never inject mock `pinData` or fake credentials directly into production workflow JSON or `prepare_deploy_plan`. Keep testing mock data isolated in the integration plan overlay.


## Workflow Design Process

### Step 1: Understand Requirements

Before generating code, clarify:

1. **Trigger type**: webhook, schedule, manual, chat, telegram, email?
2. **Data sources**: Bitrix24, Google, Microsoft, database, API?
3. **Actions**: create, update, send, transform, notify?
4. **Error handling**: retry, alert, fallback?
5. **AI integration**: OpenAI, Gemini, local LLM?

### Step 2: Select Node Types

Select appropriate n8n nodes for the user's requirements. Ensure native nodes or community nodes are preferred over generic `httpRequest` when available and configured in the instance.

## General n8n Design Guide

Use these guidelines before generating TypeScript or JSON:

### 1. Prefer Native Nodes Over `httpRequest`
Use native nodes when they are available and supported in the instance. External APIs without a native node may use `httpRequest`.

### 1.1 Avoid Deprecated or Removed Native Nodes (CRITICAL)
- **Do NOT use `n8n-nodes-base.email`**. This node is legacy, deprecated, and will render as a `?` placeholder in newer n8n instances. Always use `n8n-nodes-base.emailSend` (version 2.1) for sending SMTP emails, or `n8n-nodes-base.emailReadImap` (version 2.1) for receiving emails.
- **Do NOT use `n8n-nodes-base.start`**. This node is deprecated and replaced by `n8n-nodes-base.manualTrigger` (version 1). Always use `manualTrigger` instead of `start`.

### 3. Use Proper Credential References
Authenticated nodes must include a `credentials` object with placeholder IDs/names that match n8n credential types. Never hardcode API keys, tokens, or credentials in URLs or headers.

### 4. Node-First Beginner Workflow Design
You are an n8n workflow designer. Your main goal is to create workflows that beginners can open, inspect, and understand visually.

Hard rule:
Business logic must be visible as n8n nodes. Do not hide normal data transformation, routing, filtering, aggregation, or formatting logic inside Code nodes.

Default priority:
1. Native app node
2. Built-in Core / Flow / Data Transformation node
3. Built-in expression inside Set / Edit Fields / Filter / If / Switch
4. HTTP Request node
5. Code node only as a last resort

The Code node is forbidden by default for:
- filtering
- sorting
- limiting
- deduplication
- splitting arrays
- merging streams
- counting items
- summing values
- calculating averages
- renaming fields
- formatting strings
- basic math
- routing by status
- creating simple derived fields
- converting common formats
- sending messages when a native communication node exists

Use Code only when all of these are true:
1. No built-in n8n node can solve the task cleanly.
2. The logic cannot be expressed with Filter, If, Switch, Merge, Aggregate, Split Out, Summarize, Limit, Remove Duplicates, Sort, Rename Keys, Set/Edit Fields, or expressions.
3. A Code node is simpler than a very fragile chain of many awkward nodes.
4. The Code node is small, isolated, and has a clear name.
5. The workflow includes a short explanation: "Why Code is unavoidable".

### 4.1 Built-in Node Substitution Map
When designing workflows, replace common Code patterns with these built-in nodes:

#### Data filtering and routing
- Use Filter for keeping only matching items.
- Use If for true/false branching.
- Use Switch for multiple status/rule branches.
- Use Stop and Error for controlled failure paths.

#### Item count, limits, deduplication
- Use Limit instead of `items.slice(...)`.
- Use Remove Duplicates instead of `new Set(...)` or manual dedupe logic.
- Use Summarize for count, sum, average, min, max.
- Use Aggregate to combine many item fields into one list or object.

#### Arrays and item restructuring
- Use Split Out instead of custom loops over nested arrays.
- Use Merge instead of custom join/matching code.
- Use Compare Datasets instead of custom diff logic.
- Use Rename Keys for field renaming.
- Use Sort instead of `.sort(...)`.
- Use Set / Edit Fields (version 3.0+) for field creation, cleanup, static values, and simple mappings.

#### Format conversion and files
- Use Extract from File to convert binary data to JSON.
- Use Convert to File to convert JSON to binary.
- Use Compression for zip/unzip tasks.
- Use HTML, Markdown, and XML nodes for format conversion.
- Use Crypto for hashes, HMAC, signatures, and encryption utilities.

#### Flow control
- Use Loop Over Items / Split in Batches for batch processing.
- Use Wait for delays or pauses.
- Use Execute Sub-workflow for reusable modules.

#### Communication and human review
- Use Telegram, Slack, Gmail, Send Email, Microsoft Outlook, WhatsApp Business Cloud, Discord, Google Chat, or Microsoft Teams instead of custom API calls when available.
- Use Human Review style workflows when a person must approve, reject, or confirm something.

#### Triggers
- Use Manual Trigger for testing and demos.
- Use Schedule Trigger for recurring workflows.
- Use Webhook Trigger for external HTTP calls.
- Use Form Trigger / n8n Form for simple forms.
- Use Chat Trigger for chat workflows.
- Use Execute Workflow Trigger when another workflow starts this one.

### 4.2 Code Node Audit
Before final output, perform this audit:
1. Count all Code nodes.
2. For each Code node, list:
   - what it does
   - which built-in alternatives were considered
   - why those alternatives were rejected
3. If a Code node handles filtering, sorting, splitting, merging, deduplication, aggregation, formatting, routing, or simple math, replace it with built-in nodes.
4. If a Code node remains, keep it minimal and isolated.

The final answer must include:
Code Node Audit:
- Code nodes used: 0

If Code nodes used > 0:
- Node name:
- Reason Code is unavoidable:
- Built-in alternatives considered:
- Input example:
- Output example:

### 4.3 Beginner-Friendly Workflow Output Contract
Every generated workflow must be understandable by a beginner.

Always include:
1. Workflow goal in one sentence.
2. Node-by-node explanation.
3. Why each node is used.
4. What data enters and exits each node.
5. Which fields the user needs to edit.
6. Test input example.
7. Expected output example.
8. Code Node Audit.

Node naming rules:
- Node names must describe business intent.
- Avoid vague names like "Process data", "Transform", "Code", "Node 1".
- Prefer names like:
  - "Filter paid invoices"
  - "Split order items"
  - "Remove duplicate customers"
  - "Merge customer and payment data"
  - "Summarize daily revenue"
  - "Send Telegram confirmation"
  - "Stop if payment is missing"

A beginner should be able to understand the workflow by reading node names from left to right.

### 4.4 Node-First Quality Gate
Before final output, score the workflow:
- Built-in node coverage: 0–10
- Beginner readability: 0–10
- Code-node avoidance: 0–10
- Node naming clarity: 0–10
- Maintainability: 0–10

Minimum acceptable score:
- Built-in node coverage: 8+
- Beginner readability: 8+
- Code-node avoidance: 9+
- Node naming clarity: 8+
- Maintainability: 8+

If any score is below the minimum, revise the workflow before final output.


### 5. Schema Compliance & Escaping (CRITICAL)
- **Condition Operators (IF, Switch, Filter)**: For IF (`n8n-nodes-base.if`), Switch (`n8n-nodes-base.switch`), and Filter (`n8n-nodes-base.filter`) nodes version 2.0+, condition operators MUST be generated as nested objects (e.g., `operator: { "type": "string", "operation": "equals" }`), not simple strings.
- **Set Nodes**: For Set (`n8n-nodes-base.set`) nodes version 3.0+, values must use the `fields` array structure (e.g., `fields: [ { name: "fieldName", value: "fieldValue", type: "string" } ]`) instead of legacy `values` object structures.
- **Quotes Escaping**: When generating nested JS/JSON code inside node parameters (such as `jsCode` in Code nodes or mock data), ensure double quotes are properly escaped (`\"` or `\\"` depending on nesting depth) so the final JSON remains valid.

### 6. Deploy Checklists and Security
- Ensure the workflow compiles and handles errors gracefully.
- Placeholders and URLs should be configurable.
- Use rate limits/wait states where appropriate for high-volume API requests.

### 7. Educational Sticky Notes Structure (CRITICAL for Course Workflows)
When designing workflows, always include exactly 4 sequential sticky notes to document the workflow structure. Headers inside the sticky notes must use заголовки 3-го уровня (`###`) instead of `##` for a smaller, cleaner font size in the n8n UI.

The grouping must be exactly sequential as follows:
- **Sticky Note 1 (ID: `sticky-1`, Name: `Overview, Input Data & Concept`, Color: 1 - Yellow)**:
  - `### 1. Overview` — what the workflow demonstrates.
  - `### 2. Input Data` — what test/input data is used.
  - `### 3. Concept` — the theory/concepts taught in this workflow.
- **Sticky Note 2 (ID: `sticky-2`, Name: `Node Notes`, Color: 4 - Green)**:
  - `### 4. Node Notes` — detailed step-by-step/node-by-node explanation.
- **Sticky Note 3 (ID: `sticky-3`, Name: `Common Mistakes & Student Task`, Color: 2 - Yellow/Brown)**:
  - `### 5. Common Mistakes` — typical mistakes/pitfalls for students.
  - `### 6. Student Task` — mini-assignment or task for self-study.
- **Sticky Note 4 (ID: `sticky-4`, Name: `Expected Output & Final Check`, Color: 3 - Red)**:
  - `### 7. Expected Output` — what data or result should be produced on success.
  - `### 8. Final Check` — description of the validation or final check criteria.

## Resources

- [n8n-as-code Transformer](https://github.com/EtienneLescot/n8n-as-code)
- [n8n REST API Docs](https://docs.n8n.io/api/)
- [n8n Node Reference](https://docs.n8n.io/integrations/builtin/)

---

## Universal Node Validator Code

Below is the portable Python code for validation. To run it in any workspace, write this code block to a temporary file (e.g. `node_validator.py`), run it via `python3 node_validator.py <workflow.json>`, and then delete the temporary file.

```python
import os, json, sys, requests

STATIC_SCHEMA_RULES = {
    "n8n-nodes-base.if": [
        {"min_version": 2.0, "validate_func": lambda n, p: check_if_style(n, p)}
    ],
    "n8n-nodes-base.filter": [
        {"min_version": 2.0, "validate_func": lambda n, p: check_if_style(n, p)}
    ],
    "n8n-nodes-base.switch": [
        {"min_version": 2.0, "validate_func": lambda n, p: check_switch_style(n, p)}
    ],
    "n8n-nodes-base.set": [
        {"min_version": 3.0, "validate_func": lambda n, p: check_set_style(n, p)}
    ]
}

def check_if_style(node, params):
    errors = []
    for idx, cond in enumerate(params.get("conditions", {}).get("conditions", [])):
        operator = cond.get("operator")
        if operator is not None and isinstance(operator, str):
            errors.append(f"Condition {idx} uses legacy flat string operator: '{operator}'")
    return errors

def check_switch_style(node, params):
    errors = []
    for idx, rule in enumerate(params.get("rules", {}).get("rules", [])):
        for c_idx, cond in enumerate(rule.get("conditions", {}).get("conditions", [])):
            operator = cond.get("operator")
            if operator is not None and isinstance(operator, str):
                errors.append(f"Rule {idx}, condition {c_idx} uses legacy flat string operator: '{operator}'")
    return errors

def check_set_style(node, params):
    return ["Uses legacy 'values' object. Set v3+ requires 'fields' array."] if "values" in params else []

def load_config():
    url = os.environ.get("N8N_BASE_URL")
    key = os.environ.get("N8N_API_KEY")
    for p in ["course_materials/test_runner/config.json", "config.json"]:
        if os.path.exists(p):
            try:
                with open(p, 'r') as f:
                    conf = json.load(f)
                    url = url or conf.get("n8n_api_url")
                    key = key or conf.get("n8n_api_key")
            except Exception: pass
    return url, key

def fetch_schemas(url, key):
    if not url or not key: return None
    cache_dir = os.path.expanduser("~/.cache/n8n")
    cache_path = os.path.join(cache_dir, "node_schemas_cache.json")
    import time
    if os.path.exists(cache_path):
        if time.time() - os.path.getmtime(cache_path) < 86400:
            try:
                with open(cache_path, 'r') as f: return json.load(f)
            except Exception: pass
    try:
        r = requests.get(f"{url.rstrip('/')}/node-types", headers={"X-N8N-API-KEY": key}, timeout=5)
        if r.status_code == 200:
            schemas = {nt["name"]: nt for nt in r.json() if "name" in nt}
            os.makedirs(cache_dir, exist_ok=True)
            with open(cache_path, 'w') as f: json.dump(schemas, f)
            return schemas
    except Exception: pass
    if os.path.exists(cache_path):
        try:
            with open(cache_path, 'r') as f: return json.load(f)
        except Exception: pass
    return None

def validate_node_dynamic(node, schema):
    errors = []
    params = node.get("parameters", {})
    prop_map = {p["name"]: p for p in schema.get("properties", [])}
    for name, val in params.items():
        if isinstance(val, str) and val.startswith("="): continue
        prop = prop_map.get(name)
        if not prop:
            errors.append(f"Param '{name}' not defined in schema.")
            continue
        if prop.get("type") == "filter" and isinstance(val, dict):
            for idx, cond in enumerate(val.get("conditions", [])):
                if isinstance(cond.get("operator"), str):
                    errors.append(f"Param '{name}' condition {idx} uses legacy string operator.")
    return errors

def main():
    if len(sys.argv) < 2: sys.exit(1)
    target = sys.argv[1]
    url, key = load_config()
    schemas = fetch_schemas(url, key)
    with open(target, 'r') as f: data = json.load(f)
    errors = []
    for node in data.get("nodes", []):
        ntype = node.get("type")
        nname = node.get("name", "node")
        nver = float(node.get("typeVersion", 1))
        if ntype in STATIC_SCHEMA_RULES:
            for rule in STATIC_SCHEMA_RULES[ntype]:
                if nver >= rule["min_version"]:
                    for err in rule["validate_func"](node, node.get("parameters", {})):
                        errors.append(f"'{nname}' ({ntype} v{nver}): {err}")
        if schemas and ntype in schemas:
            for err in validate_node_dynamic(node, schemas[ntype]):
                errors.append(f"'{nname}' dynamic: {err}")
    if errors:
        for err in errors: print(err)
        sys.exit(1)
    else:
        sys.exit(0)

if __name__ == '__main__': main()
```
