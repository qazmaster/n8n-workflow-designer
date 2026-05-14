# n8n Package Integration

## Goal

Enhance the MCP workflow builder with current n8n package support while preserving the existing decorator TypeScript workflow format.

## Scope

- Install official n8n workflow packages for SDK generation and workflow types.
- Keep `@n8n-as-code/transformer` as the decorator TypeScript compiler, upgraded to the current major version.
- Add `@n8n/workflow-sdk` output support without breaking existing `design_workflow` behavior.
- Replace unsafe MCP argument casts with runtime argument parsing.

## Follow-up enhancement packet scope

- Add a shared n8n REST API helper so lifecycle tools use one typed request path.
- Add explicit deploy-by-ID, create-only, upsert-by-name, and dry-run deployment modes.
- Add workflow execution, import/export, credential metadata, and community package discovery tools.
- Add a local known-node registry for credential requirements, community package hints, and lightweight required-parameter checks.
- Preserve the existing decorator TypeScript default and avoid embedding the full `n8n` runtime package.

## Non-goals

- Do not embed the full `n8n` platform package.
- Do not change deployment credentials or call a live n8n instance.
- Do not redesign all workflow templates in this packet.
- Do not enable full SDK node schema validation until node description directories are wired into `@n8n/workflow-sdk`.
- Do not run live deployment or execution smoke tests without user-provided `N8N_API_KEY` and `N8N_BASE_URL`.
