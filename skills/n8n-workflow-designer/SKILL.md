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

### 4. Generate `Set` Nodes for Simple Transforms
Use `n8n-nodes-base.set` for field mapping, renaming, static defaults, formatting expressions, and simple extraction. Use `Code` only for complex JavaScript operations (e.g. loops, grouping, complex custom algorithms).

### 4.5 Avoid Monolithic Code Nodes for Flow Control
Never use a single complex `Code` node (e.g., 30+ lines of JavaScript/Python) to handle conditional branching, routing, filtering, or looping that can be implemented with native flow control nodes. Using JavaScript logic inside a Code node to implement custom flow routing is a critical anti-pattern.
- Use IF (`n8n-nodes-base.if`) or Switch (`n8n-nodes-base.switch`) for conditional branching and routing.
- Use Filter (`n8n-nodes-base.filter`) for filtering item arrays.
- Use Split In Batches (`n8n-nodes-base.splitInBatches`) for looping over items.
- Keep Code nodes minimal and focused only on data transformation.


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
