# n8n Package Integration

## Goal

Enhance the MCP workflow builder with current n8n package support while preserving the existing decorator TypeScript workflow format.

## Scope

- Install official n8n workflow packages for SDK generation and workflow types.
- Keep `@n8n-as-code/transformer` as the decorator TypeScript compiler, upgraded to the current major version.
- Add `@n8n/workflow-sdk` output support without breaking existing `design_workflow` behavior.
- Replace unsafe MCP argument casts with runtime argument parsing.

## Non-goals

- Do not embed the full `n8n` platform package.
- Do not change deployment credentials or call a live n8n instance.
- Do not redesign all workflow templates in this packet.
