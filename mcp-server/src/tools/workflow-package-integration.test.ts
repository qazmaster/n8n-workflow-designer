import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileWorkflow } from './compile.js';
import { deployWorkflow } from './deploy.js';
import { designWorkflow } from './design.js';
import { validateWorkflow } from './validate.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('n8n package integration', () => {
  it('generates decorator TypeScript that compiles through @n8n-as-code/transformer', async () => {
    const code = await designWorkflow({
      description: 'When webhook receives a lead, create a Bitrix24 lead and send a Telegram alert',
      workflowName: 'Lead Intake',
      includeErrorHandling: false,
    });

    const compiled = await compileWorkflow({ typescriptCode: code });

    expect(compiled.name).toBe('Lead Intake');
    expect(compiled.nodes.map((node) => node.type)).toContain('n8n-nodes-base.bitrix24');
    expect(compiled.nodes.map((node) => node.type)).toContain('n8n-nodes-base.telegram');
  });

  it('can emit @n8n/workflow-sdk-normalized JSON', async () => {
    const json = await designWorkflow({
      description: 'Manual trigger prepare data then notify telegram',
      workflowName: 'Simple Notify',
      outputFormat: 'sdk-json',
      includeErrorHandling: false,
    });

    const workflow = JSON.parse(json) as { name: string; nodes: Array<{ name: string }>; connections: Record<string, unknown> };

    expect(workflow.name).toBe('Simple Notify');
    expect(workflow.nodes.length).toBeGreaterThan(1);
    expect(Object.keys(workflow.connections).length).toBeGreaterThan(0);
  });

  it('runs official SDK validation for complete workflow JSON inputs', async () => {
    const json = await designWorkflow({
      description: 'Manual trigger prepare data then notify telegram',
      workflowName: 'Validated Notify',
      outputFormat: 'sdk-json',
      includeErrorHandling: false,
    });

    const result = await validateWorkflow({ workflowJson: JSON.parse(json) });

    expect(result.info.map((issue) => issue.code)).not.toContain('sdk-validation-skipped');
    expect(result.errors).toEqual([]);
  });

  it('updates an existing workflow by name and filters deploy-only settings', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({
      data: [{ id: 'existing-workflow-id', name: 'Existing Workflow' }],
    })).mockResolvedValueOnce(jsonResponse({
      id: 'existing-workflow-id',
      name: 'Existing Workflow',
    }));

    const result = await deployWorkflow({
      workflowJson: {
        id: 'local-id',
        name: 'Existing Workflow',
        nodes: [],
        connections: {},
        active: true,
        settings: {
          executionOrder: 'v1',
          binaryMode: 'filesystem',
          availableInMCP: true,
        },
      },
    }, 'https://n8n.example.test', 'test-api-key');

    expect(result.mode).toBe('updated');
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://n8n.example.test/api/v1/workflows/existing-workflow-id', expect.objectContaining({ method: 'PATCH' }));

    const patchInit = fetchMock.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(String(patchInit.body)) as { id?: string; active?: boolean; settings?: Record<string, unknown> };

    expect(body.id).toBeUndefined();
    expect(body.active).toBeUndefined();
    expect(body.settings).toEqual({ executionOrder: 'v1' });
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
