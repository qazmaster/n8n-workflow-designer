import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileWorkflow } from './compile.js';
import { deployWorkflow } from './deploy.js';
import { designWorkflow } from './design.js';
import { executeWorkflow } from './execute.js';
import { n8nApiRequest } from './n8n-api.js';
import { exportWorkflow, importWorkflow, listCommunityPackages, listCredentials } from './transfer.js';
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
      confirmMutation: true,
    }, 'https://n8n.example.test', 'test-api-key');

    expect(result.mode).toBe('updated');
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://n8n.example.test/api/v1/workflows/existing-workflow-id', expect.objectContaining({ method: 'PATCH' }));

    const patchInit = fetchMock.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(String(patchInit.body)) as { id?: string; active?: boolean; settings?: Record<string, unknown> };

    expect(body.id).toBeUndefined();
    expect(body.active).toBeUndefined();
    expect(body.settings).toEqual({ executionOrder: 'v1' });
  });

  it('updates an existing workflow by explicit ID without name lookup', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({
      id: 'workflow-123',
      name: 'Explicit Update',
    }));

    const result = await deployWorkflow({
      workflowId: 'workflow-123',
      confirmMutation: true,
      workflowJson: {
        name: 'Explicit Update',
        nodes: [],
        connections: {},
      },
    }, 'https://n8n.example.test', 'test-api-key');

    expect(result.mode).toBe('updated');
    expect(result.updateStrategy).toBe('update-by-id');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://n8n.example.test/api/v1/workflows/workflow-123', expect.objectContaining({ method: 'PATCH' }));
  });

  it('returns a dry-run deploy plan without mutating n8n', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await deployWorkflow({
      mode: 'create',
      dryRun: true,
      workflowJson: {
        id: 'local-id',
        name: 'Dry Run',
        nodes: [],
        connections: {},
        active: true,
      },
    }, 'https://n8n.example.test', 'test-api-key');

    expect(result).toMatchObject({ deployed: false, dryRun: true, mode: 'created', updateStrategy: 'create' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects mutating deploy calls without explicit confirmation', async () => {
    await expect(deployWorkflow({
      mode: 'create',
      workflowJson: { name: 'Unsafe Mutation', nodes: [], connections: {} },
    }, 'https://n8n.example.test', 'test-api-key')).rejects.toThrow('confirmMutation must be true');
  });

  it('rejects contradictory workflow ID and deploy mode inputs', async () => {
    await expect(deployWorkflow({
      workflowId: 'workflow-123',
      mode: 'create',
      dryRun: true,
      workflowJson: { name: 'Contradictory', nodes: [], connections: {} },
    }, 'https://n8n.example.test', '')).rejects.toThrow('workflowId can only be combined');
  });

  it('keeps dry-run deploy planning offline and redacts sensitive workflow fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await deployWorkflow({
      dryRun: true,
      workflowJson: {
        name: 'Offline Dry Run',
        nodes: [],
        connections: {},
        pinData: { node: [{ json: { secret: 'value' } }] },
        staticData: { token: 'secret-token' },
      },
    }, 'https://n8n.example.test', '');

    expect(result).toMatchObject({ deployed: false, dryRun: true, mode: 'upsert-planned', updateStrategy: 'upsert-by-name' });
    expect(result.workflow).toEqual({ name: 'Offline Dry Run', nodes: [], connections: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('encodes workflow IDs before calling n8n API paths', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ id: 'safe' }));

    await exportWorkflow({ workflowId: '../credentials' }, 'https://n8n.example.test', 'test-api-key');

    expect(fetchMock).toHaveBeenCalledWith('https://n8n.example.test/api/v1/workflows/..%2Fcredentials', expect.any(Object));
  });

  it('executes a workflow through the public execute endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({
      executionId: 42,
      waitingForWebhook: false,
    }));

    const result = await executeWorkflow({
      workflowId: 'workflow-123',
      inputData: { leadId: 'lead-1' },
      confirmMutation: true,
    }, 'https://n8n.example.test', 'test-api-key');

    expect(result).toMatchObject({ executed: true, endpoint: 'execute', workflowId: 'workflow-123' });
    expect(fetchMock).toHaveBeenCalledWith('https://n8n.example.test/api/v1/workflows/workflow-123/execute', expect.objectContaining({ method: 'POST' }));
  });

  it('rejects workflow execution without explicit mutation confirmation', async () => {
    await expect(executeWorkflow({
      workflowId: 'workflow-123',
    }, 'https://n8n.example.test', 'test-api-key')).rejects.toThrow('confirmMutation must be true');
  });

  it('redacts sensitive n8n API error response bodies', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      message: 'bad request',
      accessToken: 'secret-token',
      nested: { password: 'secret-password', safe: 'visible' },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }));

    await expect(n8nApiRequest({ baseUrl: 'https://n8n.example.test', apiKey: 'test-api-key' }, {
      method: 'GET',
      path: '/workflows',
    })).rejects.toThrow('"accessToken":"[REDACTED]"');
  });

  it('exports portable workflow JSON without instance metadata by default', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({
      id: 'workflow-123',
      name: 'Portable Workflow',
      nodes: [],
      connections: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      shared: [{ user: 'owner' }],
    }));

    const result = await exportWorkflow({ workflowId: 'workflow-123' }, 'https://n8n.example.test', 'test-api-key');
    const workflow = result.workflow as Record<string, unknown>;

    expect(result.exported).toBe(true);
    expect(workflow.name).toBe('Portable Workflow');
    expect(workflow.createdAt).toBeUndefined();
    expect(workflow.shared).toBeUndefined();
  });

  it('imports workflow JSON through deploy semantics', async () => {
    const result = await importWorkflow({
      mode: 'create',
      dryRun: true,
      workflowJson: { name: 'Imported Workflow', nodes: [], connections: {} },
    }, 'https://n8n.example.test', 'test-api-key');

    expect(result).toMatchObject({ deployed: false, dryRun: true, mode: 'created', updateStrategy: 'create' });
  });

  it('lists credential metadata without returning credential data payloads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({
      data: [{ id: 'cred-1', name: 'Telegram', type: 'telegramApi', data: { accessToken: 'secret' } }],
    }));

    const result = await listCredentials('https://n8n.example.test', 'test-api-key');
    const credentials = result.credentials as Array<Record<string, unknown>>;

    expect(credentials[0]).toEqual({ id: 'cred-1', name: 'Telegram', type: 'telegramApi' });
  });

  it('deep-redacts credential metadata returned by n8n', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({
      data: [{ id: 'cred-1', name: 'Nested', nested: { accessToken: 'secret', safe: 'visible' } }],
    }));

    const result = await listCredentials('https://n8n.example.test', 'test-api-key');
    const credentials = result.credentials as Array<Record<string, unknown>>;

    expect(credentials[0]).toEqual({ id: 'cred-1', name: 'Nested', nested: { accessToken: '[REDACTED]', safe: 'visible' } });
  });

  it('lists installed community packages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({
      data: [{ packageName: 'n8n-nodes-docxtemplater', installedVersion: '1.0.0' }],
    }));

    const result = await listCommunityPackages('https://n8n.example.test', 'test-api-key');

    expect(result.packages).toEqual([{ packageName: 'n8n-nodes-docxtemplater', installedVersion: '1.0.0' }]);
  });

  it('runs known-node registry validation for required parameters', async () => {
    const result = await validateWorkflow({
      workflowJson: {
        name: 'Registry Validation',
        nodes: [{ id: 'http-node', name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [0, 0], parameters: {} }],
        connections: {},
      },
    });

    expect(result.warnings.map((issue) => issue.code)).toContain('registry-missing-required-parameter');
    expect(result.info.map((issue) => issue.code)).toContain('schema-registry-partial');
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
