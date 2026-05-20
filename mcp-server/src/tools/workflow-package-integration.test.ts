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

  it('automatically configures retry and continueOnFail settings from description heuristics', async () => {
    const code = await designWorkflow({
      description: 'When webhook receives a lead, create a Bitrix24 lead, retry 4 times and wait 3s on error, ignore errors on non-critical Telegram alerts',
      workflowName: 'Lead Intake with Settings',
      includeErrorHandling: false,
    });

    const compiled = await compileWorkflow({ typescriptCode: code });
    const bitrix = compiled.nodes.find((n) => n.type.includes('bitrix24'));
    const telegram = compiled.nodes.find((n) => n.type.includes('telegram'));

    expect((bitrix as any)?.settings).toEqual({
      continueOnFail: true,
      retryOnFail: true,
      maxTries: 4,
      waitBetweenTries: 3000,
    });
    expect((telegram as any)?.settings).toEqual({
      continueOnFail: true,
      retryOnFail: true,
      maxTries: 4,
      waitBetweenTries: 3000,
    });
  });

  it('validates conflicting node settings (continueOnFail and retryOnFail)', async () => {
    const result = await validateWorkflow({
      workflowJson: {
        name: 'Conflicting Settings',
        nodes: [
          {
            id: 'http-node',
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4,
            position: [0, 0],
            parameters: {},
            settings: {
              continueOnFail: true,
              retryOnFail: true,
            },
          },
        ],
        connections: {},
      },
    });

    expect(result.warnings.map((issue) => issue.code)).toContain('registry-conflicting-error-settings');
  });

  it('validates unsafe continueOnFail (green-but-broken trap)', async () => {
    // 1. Without downstream check
    const result1 = await validateWorkflow({
      workflowJson: {
        name: 'Unsafe ContinueOnFail',
        nodes: [
          {
            id: 'http-node',
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4,
            position: [0, 0],
            parameters: {},
            settings: {
              continueOnFail: true,
            },
          },
          {
            id: 'set-node',
            name: 'Set Data',
            type: 'n8n-nodes-base.set',
            typeVersion: 1,
            position: [200, 0],
            parameters: {},
          },
        ],
        connections: {
          'HTTP Request': {
            main: [[{ node: 'Set Data', type: 'main', index: 0 }]],
          },
        },
      },
    });

    expect(result1.warnings.map((issue) => issue.code)).toContain('registry-unsafe-continue-on-fail');

    // 2. With downstream check (IF node referencing HTTP Request error)
    const result2 = await validateWorkflow({
      workflowJson: {
        name: 'Safe ContinueOnFail',
        nodes: [
          {
            id: 'http-node',
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4,
            position: [0, 0],
            parameters: {},
            settings: {
              continueOnFail: true,
            },
          },
          {
            id: 'if-node',
            name: 'Check Error',
            type: 'n8n-nodes-base.if',
            typeVersion: 1,
            position: [200, 0],
            parameters: {
              conditions: {
                options: {
                  leftValue: '={{ $json.error }}',
                },
              },
            },
          },
        ],
        connections: {
          'HTTP Request': {
            main: [[{ node: 'Check Error', type: 'main', index: 0 }]],
          },
        },
      },
    });

    expect(result2.warnings.map((issue) => issue.code)).not.toContain('registry-unsafe-continue-on-fail');
  });

  it('automatically adds a global overview sticky note and individual node sticky notes with clean layouts', async () => {
    const json = await designWorkflow({
      description: 'Manual trigger: prepare data and log it',
      workflowName: 'Test Sticky Notes Workflow',
      outputFormat: 'sdk-json',
      includeErrorHandling: false,
    });

    const workflow = JSON.parse(json) as {
      name: string;
      nodes: Array<{
        name: string;
        type: string;
        position: [number, number];
        parameters?: {
          content?: string;
          width?: number;
          height?: number;
          color?: string | number;
        };
      }>;
    };

    const stickyNotes = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote');
    expect(stickyNotes.length).toBeGreaterThan(1);

    const overviewNote = stickyNotes.find((n) => n.name === 'Workflow Overview Note');
    expect(overviewNote).toBeDefined();
    expect(overviewNote?.position).toEqual([-180, 120]);
    expect(overviewNote?.parameters?.content).toContain('# 📋 Workflow Overview');
    expect(overviewNote?.parameters?.content).toContain('https://img.shields.io/badge/n8n-workflow_designer-EA4AAA#full-width');
    expect(overviewNote?.parameters?.width).toBe(340);
    expect(overviewNote?.parameters?.height).toBe(300);
    expect(overviewNote?.parameters?.color).toBe('#f9f0ff');

    const triggerNote = stickyNotes.find((n) => n.name === 'Note: Manual Trigger');
    expect(triggerNote).toBeDefined();
    expect(triggerNote?.position).toEqual([200, 120]);
    expect(triggerNote?.parameters?.content).toContain('### 📦 Manual Trigger');
    expect(triggerNote?.parameters?.color).toBe('#fff7e6');
  });

  it('automatically adds YouTube embeds and AI backdrop container for AI Agent workflows', async () => {
    const json = await designWorkflow({
      description: 'Trigger when chat message received, use AI Agent with Memory',
      workflowName: 'Test AI Agent Sticky Notes Workflow',
      outputFormat: 'sdk-json',
      includeErrorHandling: false,
    });

    const workflow = JSON.parse(json) as {
      name: string;
      nodes: Array<{
        name: string;
        type: string;
        position: [number, number];
        parameters?: {
          content?: string;
          width?: number;
          height?: number;
          color?: string | number;
        };
      }>;
    };

    const stickyNotes = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote');
    
    // Overview note should have video embed and height = 480
    const overviewNote = stickyNotes.find((n) => n.name === 'Workflow Overview Note');
    expect(overviewNote).toBeDefined();
    expect(overviewNote?.parameters?.content).toContain('@[youtube](ZCuL2e4zC_4)');
    expect(overviewNote?.parameters?.height).toBe(480);

    // AI Agent backdrop container note should exist
    const backdropNote = stickyNotes.find((n) => n.name === 'AI Agent Container Backdrop');
    expect(backdropNote).toBeDefined();
    expect(backdropNote?.parameters?.content).toContain('# 🧠 AI Brain Core');
    expect(backdropNote?.parameters?.color).toBe('#f6ffed');
    expect(backdropNote?.parameters?.width).toBe(380);
    expect(backdropNote?.parameters?.height).toBe(340);
  });

  it('validates deprecated or high-risk community packages', async () => {
    const result = await validateWorkflow({
      workflowJson: {
        name: 'Deprecated Community Node Test',
        nodes: [
          {
            id: 'node-evolution',
            name: 'Evolution API',
            type: 'n8n-nodes-evolution-api.evolutionApi',
            typeVersion: 1,
            position: [0, 0],
            parameters: {},
          },
          {
            id: 'node-chatwoot-legacy',
            name: 'Legacy Chatwoot',
            type: 'n8n-nodes-chatwoot.chatwoot',
            typeVersion: 1,
            position: [200, 0],
            parameters: {},
          }
        ],
        connections: {},
      },
    });

    const warningCodes = result.warnings.map(w => w.code);
    expect(warningCodes).toContain('deprecated-community-node');
    expect(result.warnings.some(w => w.message.includes('account ban risk'))).toBe(true);
    expect(result.warnings.some(w => w.message.includes('unscoped'))).toBe(true);
  });

  it('generates firecrawl and palatine speech community nodes from prompt keywords', async () => {
    const code = await designWorkflow({
      description: 'When webhook receives a payload, scrape the web page with firecrawl and transcribe audio with palatine speech',
      workflowName: 'Community Node Automation',
      includeErrorHandling: false,
    });

    expect(code).toContain('// Community nodes required:');
    expect(code).toContain('@mendable/n8n-nodes-firecrawl.firecrawl (@mendable/n8n-nodes-firecrawl)');
    expect(code).toContain('n8n-nodes-palatine-speech.palatinespeech (n8n-nodes-palatine-speech)');

    const compiled = await compileWorkflow({ typescriptCode: code });
    expect(compiled.nodes.map(n => n.type)).toContain('@mendable/n8n-nodes-firecrawl.firecrawl');
    expect(compiled.nodes.map(n => n.type)).toContain('n8n-nodes-palatine-speech.palatinespeech');
  });

  it('validates Code nodes used for flow control instead of native nodes', async () => {
    // 1. Test JSON workflow validation
    const jsonResult = await validateWorkflow({
      workflowJson: {
        name: 'Monolithic Code Node Test',
        nodes: [
          {
            id: 'node-code',
            name: 'Flow Control Node',
            type: 'n8n-nodes-base.code',
            typeVersion: 1,
            position: [0, 0],
            parameters: {
              jsCode: `// Some complex JavaScript code
const items = [{ id: 1, val: 5 }, { id: 2, val: 12 }, { id: 3, val: 18 }];
const filtered = items.filter(item => item.val > 10);
for (const item of filtered) {
  if (item.val === 12) {
    item.status = 'medium';
  } else {
    item.status = 'high';
  }
}
// more lines to exceed 15 lines threshold
// line 11
// line 12
// line 13
// line 14
// line 15
// line 16
// line 17
// line 18
return filtered;`
            },
          }
        ],
        connections: {},
      },
    });

    expect(jsonResult.warnings.map(w => w.code)).toContain('prefer-native-flow-control');

    // 2. Test TypeScript workflow validation
    const tsCode = `
import { Workflow, node } from '@n8n-as-code/decorators';

@Workflow({
  name: 'TypeScript Code Node Test',
})
export class FlowControlWorkflow {
  @node({
    id: 'node-code',
    name: 'Flow Control Node',
    type: 'n8n-nodes-base.code',
    version: 1,
    position: [0, 0],
  })
  FlowControlNode = {
    jsCode: \`
const items = [{ id: 1, val: 5 }, { id: 2, val: 12 }, { id: 3, val: 18 }];
const filtered = items.filter(item => item.val > 10);
for (const item of filtered) {
  if (item.val === 12) {
    item.status = 'medium';
  } else {
    item.status = 'high';
  }
}
// line 11
// line 12
// line 13
// line 14
// line 15
// line 16
// line 17
// line 18
return filtered;\`
  };
}
`;
    const tsResult = await validateWorkflow({
      typescriptCode: tsCode,
    });

    expect(tsResult.warnings.map(w => w.code)).toContain('prefer-native-flow-control');
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
