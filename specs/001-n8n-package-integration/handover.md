---
title: Handover — n8n Package Integration
type: handover_state
spec: 001-n8n-package-integration
status: current
importance: important
---

# Handover — n8n Package Integration

## Current state

The original n8n package integration work was completed, committed, and pushed to `main`. A follow-up enhancement packet has now been implemented locally to cover the remaining high-value items from npm/API/package research: safer deployment modes, REST API helper reuse, execution, import/export, credential metadata, community package discovery, and known-node registry validation.

## What shipped

- Added runtime dependencies: `@n8n/workflow-sdk`, `n8n-workflow`, and upgraded `@n8n-as-code/transformer` to `^2.0.0`.
- Added development tooling: `@n8n/cli` and `n8nac`.
- Added `design_workflow.outputFormat` with `decorator-typescript`, `sdk-json`, and `both` modes.
- Kept decorator TypeScript as the default output to preserve existing behavior.
- Added SDK-normalized JSON generation through `@n8n/workflow-sdk`.
- Added SDK validation for complete workflow JSON in `validate_workflow`.
- Replaced unsafe MCP `as any` argument dispatch with runtime parsing and `InvalidParams` errors.
- Improved `deploy_workflow` so `updateExisting` updates workflows by name with `PATCH` by default, while `updateExisting: false` forces creation.
- Aligned deploy settings sanitization with the existing batch deployment script.
- Fixed compile temp-file cleanup to run immediately after compilation.
- Added integration coverage for design/compile, SDK JSON output, SDK validation, and update-existing deploy behavior.
- Updated the README and bundled `n8n-workflow-designer` skill docs for the new behavior.

## Follow-up enhancement packet

- Added a shared `n8nApiRequest` helper for consistent `/api/v1` calls and API-key handling.
- Added explicit `deploy_workflow.workflowId`, `mode`, and `dryRun` support.
- Added `confirmMutation` gating for mutating deploy/import calls and offline dry-run planning.
- Added `execute_workflow` with `execute` and `run` endpoint compatibility, optional execution polling, and `confirmMutation` gating.
- Added `export_workflow` and `import_workflow` for portable workflow JSON movement.
- Added `list_credentials` with defensive secret redaction and `list_community_packages` for target-instance package discovery.
- Added a known-node registry for credential requirements, community package hints, and lightweight required-parameter checks.
- Updated `validate_workflow.schemaValidation` to support `known-node-registry` or `off`.
- Updated tests, README, skill docs, spec, and task tracking for these tools.

## Commits pushed

- `e368d46` — Add n8n workflow package dependencies
- `c928ceb` — Integrate n8n workflow SDK support
- `4a223a5` — Add n8n package integration coverage
- `4dc0006` — Document n8n workflow SDK enhancements

## Verification evidence

Latest verified state before documentation commit:

- `lsp_diagnostics mcp-server/src`: 0 errors, 0 diagnostics
- `npm run build`: passed
- `npm test`: 1 file passed, 4/4 tests passed
- grep for `as any|@ts-ignore|@ts-nocheck` in `mcp-server/src`: no matches
- Oracle security re-review: PASS, no blocking findings

Documentation verification after the docs update:

- Grep confirmed README and skill docs mention `outputFormat`, `sdk-json`, `@n8n/workflow-sdk`, SDK validation, credential placeholders, and `updateExisting`.
- Docs were committed and pushed as `4dc0006`.

Follow-up enhancement verification:

- `lsp_diagnostics` on changed MCP TypeScript files: 0 errors after fixes.
- `npm test`: passed, 1 file passed, 12/12 tests passed.
- `npm run build`: passed.
- grep for `as any|@ts-ignore|@ts-nocheck` in `mcp-server/src`: no matches.
- Live n8n smoke tests were not run because `N8N_API_KEY` and `N8N_BASE_URL` were not provided for a disposable target instance.

## Important caveats

- No live n8n deployment was run because it requires user-provided `N8N_API_KEY` and `N8N_BASE_URL`.
- `deploy_workflow` now supports explicit update-by-ID. For production automation, prefer `workflowId` or `mode: "update-by-id"` over name-based upserts, and use `confirmMutation: true` only after reviewing a dry run.
- SDK validation still runs with full SDK schema validation disabled, because node type schema provider wiring is not implemented in this packet. The local known-node registry provides partial checks only.
- `npm install` reported 4 moderate vulnerabilities during implementation. No forced audit fix was applied because no concrete exploit path was established and forced fixes may introduce breaking changes.

## Recommended next actions

1. Run live deploy/export/import/execute smoke tests against a disposable n8n instance using `N8N_API_KEY` and `N8N_BASE_URL`.
2. Investigate wiring n8n node schema directories into `@n8n/workflow-sdk` validation so `validateSchema` can be enabled.
3. Expand the known-node registry from `n8n-nodes-base` descriptions or generated node metadata.
4. Review dependency audit output and decide whether to schedule a separate dependency-hardening pass.
5. Consider ignoring `.sisyphus/` if it is consistently local runtime state.

## Fast resume prompt

Read this file plus `README.md`, `skills/n8n-workflow-designer/SKILL.md`, `mcp-server/src/index.ts`, `mcp-server/src/tools/n8n-api.ts`, `mcp-server/src/tools/node-registry.ts`, `mcp-server/src/tools/execute.ts`, `mcp-server/src/tools/transfer.ts`, and `mcp-server/src/tools/workflow-package-integration.test.ts`. Start with live n8n smoke tests or full SDK schema-provider wiring.
