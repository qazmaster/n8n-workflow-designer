import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileWorkflow } from './compile.js';
import { deployWorkflow } from './deploy.js';
import { designWorkflow } from './design.js';
import { executeWorkflow } from './execute.js';
import { n8nApiRequest } from './n8n-api.js';
import { exportWorkflow, importWorkflow, listCommunityPackages, listCredentials } from './transfer.js';
import { validateWorkflow } from './validate.js';
import {
  prepareDeployPlan,
  prepareExecutionPlan,
  prepareImportPlan,
  prepareExportPlan,
} from './prepare.js';
import {
  generateTestContract,
  validateWorkflowAgainstContract,
} from './test-contract.js';
import {
  prepareOfflineTestSuite,
  prepareIntegrationTestPlan,
  evaluateExecutionResult,
} from './test-suite.js';
import {
  prepareSandboxDeployPlan,
  prepareExecutionSuite,
  prepareRepairPatch,
  preparePromotionPlan,
  prepareCleanupPlan,
  applyRepairPatch,
  prepareRetestPlan,
  evaluateRepairScope,
  prepareRefactorPlan,
  prepareRedesignPlan,
  generateWorkflowVariant,
  compareWorkflowVariants,
  prepareMigrationPlan,
} from './sandbox.js';

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
    expect(overviewNote?.parameters?.content).toContain('\n');
    expect(overviewNote?.parameters?.content).not.toContain('\\n');
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

  it('generates bitrix community and document converter nodes from prompt keywords', async () => {
    const code = await designWorkflow({
      description: 'When a webhook receives a file, convert document to markdown and upload lead to community bitrix CRM',
      workflowName: 'Bitrix and Document Conversion',
      includeErrorHandling: false,
    });

    expect(code).toContain('// Community nodes required:');
    expect(code).toContain('@mazix/n8n-nodes-converter-documents.converterDocuments (@mazix/n8n-nodes-converter-documents)');
    expect(code).toContain('n8n-nodes-bitrix.bitrix (n8n-nodes-bitrix)');

    const compiled = await compileWorkflow({ typescriptCode: code });
    expect(compiled.nodes.map(n => n.type)).toContain('@mazix/n8n-nodes-converter-documents.converterDocuments');
    expect(compiled.nodes.map(n => n.type)).toContain('n8n-nodes-bitrix.bitrix');
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

  it('generates emailSend and emailReadImap nodes when requested', async () => {
    const code = await designWorkflow({
      description: 'When a new email is received via imap, send an email confirmation via smtp',
      workflowName: 'Email Loop',
      includeErrorHandling: false,
    });

    expect(code).toContain('n8n-nodes-base.emailReadImap');
    expect(code).toContain('n8n-nodes-base.emailSend');

    const compiled = await compileWorkflow({ typescriptCode: code });
    expect(compiled.nodes.map(n => n.type)).toContain('n8n-nodes-base.emailReadImap');
    expect(compiled.nodes.map(n => n.type)).toContain('n8n-nodes-base.emailSend');
  });

  it('validates deprecated native nodes (email and start)', async () => {
    // 1. JSON workflow validation
    const jsonResult = await validateWorkflow({
      workflowJson: {
        name: 'Deprecated Native Nodes Test',
        nodes: [
          {
            id: 'legacy-email',
            name: 'Old Email Node',
            type: 'n8n-nodes-base.email',
            typeVersion: 1,
            position: [0, 0],
            parameters: {},
          },
          {
            id: 'legacy-start',
            name: 'Start Node',
            type: 'n8n-nodes-base.start',
            typeVersion: 1,
            position: [200, 0],
            parameters: {},
          }
        ],
        connections: {},
      },
    });

    const warningCodes = jsonResult.warnings.map(w => w.code);
    expect(warningCodes).toContain('deprecated-native-node');
    expect(jsonResult.warnings.filter(w => w.code === 'deprecated-native-node').length).toBe(2);

    // 2. TypeScript workflow validation
    const tsCode = `
import { Workflow, node } from '@n8n-as-code/decorators';

@Workflow({
  name: 'TypeScript Deprecated Nodes Test',
})
export class DeprecatedNodesWorkflow {
  @node({
    id: 'legacy-email',
    name: 'Old Email Node',
    type: 'n8n-nodes-base.email',
    version: 1,
    position: [0, 0],
  })
  OldEmailNode = {};

  @node({
    id: 'legacy-start',
    name: 'Start Node',
    type: 'n8n-nodes-base.start',
    version: 1,
    position: [200, 0],
  })
  StartNode = {};
}
`;
    const tsResult = await validateWorkflow({
      typescriptCode: tsCode,
    });

    const tsWarningCodes = tsResult.warnings.map(w => w.code);
    expect(tsWarningCodes).toContain('deprecated-native-node');
    expect(tsResult.warnings.filter(w => w.code === 'deprecated-native-node').length).toBe(2);
  });

  describe('delegated deploy mode and prepare tools', () => {
    const sampleWorkflowJson = {
      name: 'Test Delegated Workflow',
      nodes: [
        {
          id: 'manual-trigger',
          name: 'When clicking "Test workflow"',
          type: 'n8n-nodes-base.manualTrigger',
          typeVersion: 1,
          position: [0, 0],
        },
      ],
      connections: {},
    };

    it('prepare_deploy_plan compiles, sanitizes, and recommends correct tools', async () => {
      const plan = await prepareDeployPlan({
        workflowJson: sampleWorkflowJson,
        mode: 'upsert-by-name',
        activate: true,
      });

      expect(plan.mode).toBe('delegated');
      expect(plan.strategy).toBe('upsert-by-name');
      expect(plan.activate).toBe(true);
      expect(plan.sanitizedWorkflowJson.name).toBe('Test Delegated Workflow');
      expect(plan.recommendedMcpTool).toBe('n8n_create_workflow');
      expect(plan.recommendedMcpArguments.name).toBe('Test Delegated Workflow');
      expect(plan.recommendedNextTool).toBe('n8n_list_workflows');
      expect(plan.requiredTools).toEqual(['n8n_list_workflows', 'n8n_create_workflow', 'n8n_update_full_workflow']);
      expect(plan.instructions).toContain('n8n_list_workflows');
      expect(plan.instructions).toContain('CRITICAL: Before calling the recommended tool, check if the required n8n-mcp tools');
    });

    it('prepare_deploy_plan supports TypeScript compilation', async () => {
      const tsCode = `
import { workflow, node } from '@n8n-as-code/transformer';

@workflow({
  name: 'TS Compile Delegated',
})
export class TSWorkflow {
  @node({
    id: 'manual-trigger',
    name: 'Manual Trigger',
    type: 'n8n-nodes-base.manualTrigger',
    version: 1,
    position: [0, 0],
  })
  trigger = {};
}
`;
      const plan = await prepareDeployPlan({
        typescriptCode: tsCode,
        mode: 'create',
      });

      expect(plan.mode).toBe('delegated');
      expect(plan.strategy).toBe('create');
      expect(plan.sanitizedWorkflowJson.name).toBe('TS Compile Delegated');
      expect(plan.recommendedMcpTool).toBe('n8n_create_workflow');
      expect(plan.recommendedNextTool).toBe('n8n_create_workflow');
      expect(plan.requiredTools).toEqual(['n8n_create_workflow']);
      expect(plan.instructions).toContain('CRITICAL: Before calling the recommended tool, check if the required n8n-mcp tools');
    });

    it('prepare_execution_plan formats correct arguments for n8n_test_workflow', async () => {
      const plan = await prepareExecutionPlan({
        workflowId: '12345',
        inputData: { query: 'hello' },
        triggerType: 'chat',
        message: 'testing message',
      });

      expect(plan.mode).toBe('delegated');
      expect(plan.workflowId).toBe('12345');
      expect(plan.recommendedMcpTool).toBe('n8n_test_workflow');
      expect(plan.recommendedNextTool).toBe('n8n_test_workflow');
      expect(plan.requiredTools).toEqual(['n8n_test_workflow']);
      expect(plan.recommendedMcpArguments).toEqual({
        workflowId: '12345',
        data: { query: 'hello' },
        triggerType: 'chat',
        message: 'testing message',
      });
      expect(plan.instructions).toContain('CRITICAL: Before calling the recommended tool, check if the required n8n-mcp tools');
    });

    it('prepare_import_plan delegates to prepareDeployPlan', async () => {
      const plan = await prepareImportPlan({
        workflowJson: sampleWorkflowJson,
        mode: 'create',
      });

      expect(plan.mode).toBe('delegated');
      expect(plan.strategy).toBe('create');
      expect(plan.recommendedMcpTool).toBe('n8n_create_workflow');
      expect(plan.recommendedNextTool).toBe('n8n_create_workflow');
      expect(plan.requiredTools).toEqual(['n8n_create_workflow']);
      expect(plan.instructions).toContain('CRITICAL: Before calling the recommended tool, check if the required n8n-mcp tools');
    });

    it('prepare_export_plan recommends n8n_get_workflow', async () => {
      const plan = await prepareExportPlan({
        workflowId: '999',
        includeMetadata: false,
      });

      expect(plan.mode).toBe('delegated');
      expect(plan.workflowId).toBe('999');
      expect(plan.includeMetadata).toBe(false);
      expect(plan.recommendedMcpTool).toBe('n8n_get_workflow');
      expect(plan.recommendedNextTool).toBe('n8n_get_workflow');
      expect(plan.requiredTools).toEqual(['n8n_get_workflow']);
      expect(plan.recommendedMcpArguments).toEqual({
        id: '999',
        mode: 'full',
      });
      expect(plan.instructions).toContain('metadata');
      expect(plan.instructions).toContain('CRITICAL: Before calling the recommended tool, check if the required n8n-mcp tools');
    });
  });

  describe('Three-Layered TDD Model', () => {
    it('generateTestContract parses prompt and spec to produce a contract', async () => {
      const contract = await generateTestContract({
        prompt: 'Create a lead in Bitrix24 from webhook',
        workflowSpec: JSON.stringify({
          nodes: [
            { name: 'Webhook', type: 'n8n-nodes-base.webhook' },
            { name: 'Bitrix24 CRM', type: 'n8n-nodes-base.bitrix24' }
          ]
        })
      });

      expect(contract.workflowName).toBe('Generated Workflow Test Contract');
      expect(contract.testCases.length).toBe(1);
      expect(contract.testCases[0].expected.pathExists).toEqual(['Webhook', 'Bitrix24 CRM']);
    });

    it('validateWorkflowAgainstContract validates path and secrets policies', async () => {
      const contract = {
        workflowName: 'Test Contract',
        testCases: [
          {
            id: 'path_check',
            expected: {
              pathExists: ['Trigger', 'Action']
            }
          }
        ],
        forbidden: {
          credentials: true,
          nodes: ['forbidden-node']
        }
      };

      const invalidWorkflow = {
        nodes: [
          { name: 'Trigger', type: 'n8n-nodes-base.webhook', parameters: { api_key: 'plainTextPassword123' } },
          { name: 'Action', type: 'n8n-nodes-base.telegram' },
          { name: 'BadNode', type: 'forbidden-node' }
        ],
        connections: {
          'Trigger': {
            main: [[]] // Disconnected
          }
        }
      };

      const result = await validateWorkflowAgainstContract({
        workflowJson: invalidWorkflow,
        contract
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('credential/secret'))).toBe(true);
      expect(result.errors.some(e => e.includes('forbidden node'))).toBe(true);
      expect(result.errors.some(e => e.includes('path from "Trigger" to "Action"'))).toBe(true);
    });

    it('prepareOfflineTestSuite and prepareIntegrationTestPlan generate plans', async () => {
      const contract = {
        workflowName: 'Test Contract',
        testCases: [
          {
            id: 'test_1',
            input: { body: { name: 'TDD User' } },
            expected: {
              pathExists: ['Trigger', 'Action'],
              finalOutput: { ok: true }
            }
          }
        ]
      };

      const workflowJson = {
        name: 'Test Workflow',
        nodes: [
          { name: 'Trigger', type: 'n8n-nodes-base.webhook' },
          { name: 'Action', type: 'n8n-nodes-base.telegram' }
        ],
        connections: {}
      };

      const offlinePlan = await prepareOfflineTestSuite({
        workflowPath: '/path/to/workflow.json',
        testPath: '/path/to/workflow.test.ts'
      });
      expect(offlinePlan.testCode).toContain('describe(\'Workflow Offline Contract');

      const integrationPlan = await prepareIntegrationTestPlan({
        workflowJson,
        contract
      });
      expect(integrationPlan.mode).toBe('delegated');
      expect(integrationPlan.pinData).toEqual({
        'Trigger': [{ json: { name: 'TDD User' } }]
      });
      expect(integrationPlan.assertions).toEqual([
        {
          testCaseId: 'test_1',
          nodeName: 'Action',
          expectedOutput: { ok: true }
        }
      ]);
    });

    it('evaluateExecutionResult verifies assertions against logs', async () => {
      const assertions = [
        {
          testCaseId: 'test_1',
          nodeName: 'Action',
          expectedOutput: { ok: true, id: 100 }
        }
      ];

      const executionResult = {
        data: {
          resultData: {
            runData: {
              'Action': [
                {
                  data: {
                    main: [
                      [
                        {
                          json: { ok: true, id: 100 }
                        }
                      ]
                    ]
                  }
                }
              ]
            }
          }
        }
      };

      const result = await evaluateExecutionResult({
        executionResult,
        assertions
      });

      expect(result.success).toBe(true);
      expect(result.results[0].passed).toBe(true);
    });
  });

  describe('Sandbox Runtime TDD and Repair Loop', () => {
    const sampleWorkflowJson = {
      name: 'Intake Workflow',
      nodes: [
        { name: 'Webhook', type: 'n8n-nodes-base.webhook' },
        { name: 'Bitrix24 CRM', type: 'n8n-nodes-base.bitrix24' }
      ],
      connections: {},
      settings: {}
    };

    it('prepare_sandbox_deploy_plan returns test-inactive clone settings', async () => {
      const plan = await prepareSandboxDeployPlan({
        workflowJson: sampleWorkflowJson,
        sandboxSuffix: '_test'
      });

      expect(plan.mode).toBe('delegated');
      expect(plan.target).toBe('sandbox');
      expect(plan.workflowName).toBe('[TEST] Intake Workflow_test');
      expect(plan.active).toBe(false);
      expect(plan.tags).toContain('test');
      expect(plan.sanitizedWorkflowJson.name).toBe('[TEST] Intake Workflow_test');
      expect(plan.sanitizedWorkflowJson.active).toBe(false);
      expect(plan.recommendedMcpTool).toBe('n8n_create_workflow');
      expect(plan.requiredTools).toContain('n8n_list_workflows');
    });

    it('prepare_execution_suite parses test cases', async () => {
      const contract = {
        workflowName: 'Test Contract',
        testCases: [
          {
            id: 'tc1',
            description: 'Verify lead intake',
            input: { name: 'Alice' },
            expected: { pathExists: ['Webhook', 'Bitrix24 CRM'], finalOutput: { ok: true } }
          }
        ]
      };

      const suite = await prepareExecutionSuite({
        workflowId: 'test-clone-123',
        contract
      });

      expect(suite.mode).toBe('delegated');
      expect(suite.workflowId).toBe('test-clone-123');
      expect(suite.testCases.length).toBe(1);
      expect(suite.testCases[0].id).toBe('tc1');
      expect(suite.testCases[0].recommendedMcpArguments.data).toEqual({ name: 'Alice' });
      expect(suite.testCases[0].assertions[0].nodeName).toBe('Bitrix24 CRM');
    });

    it('prepare_repair_patch diagnoses expression errors and auto-detects fix', async () => {
      const testWorkflow = {
        name: 'Intake Workflow',
        nodes: [
          {
            name: 'Bitrix24 CRM',
            type: 'n8n-nodes-base.bitrix24',
            parameters: {
              leadName: '{{ $json.Alice }}'
            }
          }
        ],
        connections: {},
        settings: {}
      };

      const executionResult = {
        data: {
          resultData: {
            runData: {
              'Bitrix24 CRM': [
                {
                  error: {
                    message: ' Alice is not defined ',
                    code: 'expression_error'
                  },
                  data: {
                    main: [[{ json: { contact: { Alice: 'Alice' } } }]]
                  }
                }
              ]
            }
          }
        }
      };

      const patch = await prepareRepairPatch({
        workflowJson: testWorkflow,
        executionResult
      });

      expect(patch.status).toBe('failed');
      expect(patch.failedNode).toBe('Bitrix24 CRM');
      expect(patch.errorClass).toBe('expression_input_shape_mismatch');
      expect(patch.suspectedCause).toContain('expression references a parameter');
      expect(patch.autoRepairAllowed).toBe(true);
      expect(patch.recommendedPatch).toBeDefined();
      expect(patch.recommendedPatch?.path).toBe('parameters.leadName');
      expect(patch.recommendedPatch?.from).toBe('{{ $json.Alice }}');
      expect(patch.recommendedPatch?.to).toBe('{{ $json.contact.Alice }}');
    });

    it('prepare_repair_patch blocks auto-repair on credential errors', async () => {
      const executionResult = {
        data: {
          resultData: {
            runData: {
              'Bitrix24 CRM': [
                {
                  error: {
                    message: 'Invalid API credentials provided',
                    code: 'credential_error'
                  },
                  data: {
                    main: [[{ json: {} }]]
                  }
                }
              ]
            }
          }
        }
      };

      const patch = await prepareRepairPatch({
        workflowJson: sampleWorkflowJson,
        executionResult
      });

      expect(patch.status).toBe('failed');
      expect(patch.errorClass).toBe('credential_configuration_error');
      expect(patch.autoRepairAllowed).toBe(false);
      expect(patch.safetyReason).toContain('forbidden');
    });

    it('apply_repair_patch applies node parameter modification', async () => {
      const testWorkflow = {
        name: 'Intake Workflow',
        nodes: [
          {
            name: 'Bitrix24 CRM',
            type: 'n8n-nodes-base.bitrix24',
            parameters: {
              leadName: '{{ $json.Alice }}'
            }
          }
        ]
      };

      const result = await applyRepairPatch({
        workflowJson: testWorkflow,
        patch: {
          node: 'Bitrix24 CRM',
          path: 'parameters.leadName',
          to: '{{ $json.contact.Alice }}'
        }
      });

      expect(result.success).toBe(true);
      expect(result.workflowJson.nodes[0].parameters.leadName).toBe('{{ $json.contact.Alice }}');
    });

    it('prepare_retest_plan generates update plan', async () => {
      const testWorkflow = {
        name: 'Intake Workflow',
        nodes: [
          {
            name: 'Bitrix24 CRM',
            type: 'n8n-nodes-base.bitrix24',
            parameters: {
              leadName: '{{ $json.contact.Alice }}'
            }
          }
        ]
      };

      const plan = await prepareRetestPlan({
        sandboxWorkflowId: 'sandbox-123',
        workflowJson: testWorkflow
      });

      expect(plan.mode).toBe('delegated');
      expect(plan.recommendedMcpTool).toBe('n8n_update_full_workflow');
      expect(plan.recommendedMcpArguments.id).toBe('sandbox-123');
      expect(plan.recommendedMcpArguments.nodes[0].parameters.leadName).toBe('{{ $json.contact.Alice }}');
      expect(plan.requiredTools).toContain('n8n_update_full_workflow');
    });


    it('prepare_promotion_plan blocks promotion if gates fail and allows if gates pass', async () => {
      const failedGatesResult = await preparePromotionPlan({
        testWorkflowId: 'test-clone-123',
        workflowJson: sampleWorkflowJson,
        gates: {
          staticValidation: 'passed',
          sandboxExecutions: 'failed',
          credentialPolicy: 'passed',
          noTestArtifacts: 'passed'
        }
      });

      expect(failedGatesResult.promotionAllowed).toBe(false);
      expect(failedGatesResult.failedGates).toContain('sandboxExecutions');

      const passedGatesResult = await preparePromotionPlan({
        testWorkflowId: 'test-clone-123',
        productionWorkflowId: 'prod-456',
        workflowJson: sampleWorkflowJson,
        gates: {
          staticValidation: 'passed',
          sandboxExecutions: 'passed',
          credentialPolicy: 'passed',
          noTestArtifacts: 'passed'
        }
      });

      expect(passedGatesResult.promotionAllowed).toBe(true);
      expect(passedGatesResult.target?.mode).toBe('update-by-id');
      expect(passedGatesResult.target?.productionWorkflowId).toBe('prod-456');
      expect(passedGatesResult.sanitizedWorkflowJson?.name).toBe('Intake Workflow');
      expect(passedGatesResult.sanitizedWorkflowJson?.active).toBe(true);
    });

    it('prepare_cleanup_plan builds cleanup commands', async () => {
      const plan = await prepareCleanupPlan({
        sandboxWorkflowId: 'test-clone-123'
      });

      expect(plan.mode).toBe('delegated');
      expect(plan.recommendedMcpTool).toBe('n8n_delete_workflow');
      expect(plan.recommendedMcpArguments.id).toBe('test-clone-123');
      expect(plan.requiredTools).toEqual(['n8n_delete_workflow']);
    });

    it('evaluate_repair_scope classifies repairs correctly based on failed attempts and message keywords', async () => {
      const basicWorkflow = { name: 'Basic Workflow', nodes: [], connections: {}, settings: {} };

      // 1. Level 1 (Patch)
      const resPatch = await evaluateRepairScope({
        workflowJson: basicWorkflow,
        failedAttempts: 0,
        executionResult: { runData: {} }
      });
      expect(resPatch.scope).toBe('patch');
      expect(resPatch.autoApplyAllowed).toBe(true);

      // 2. Level 2 (Refactor)
      const resRefactor = await evaluateRepairScope({
        workflowJson: basicWorkflow,
        failedAttempts: 1,
        executionResult: {
          runData: {
            'Node A': [{ error: { message: 'Need validation of phone number format' } }]
          }
        }
      });
      expect(resRefactor.scope).toBe('refactor');
      expect(resRefactor.autoApplyAllowed).toBe(true);

      // 3. Level 3 (Redesign) via keywords
      const resRedesignKw = await evaluateRepairScope({
        workflowJson: basicWorkflow,
        failedAttempts: 1,
        executionResult: {
          runData: {
            'Node B': [{ error: { message: 'Authentication failure: invalid credentials' } }]
          }
        }
      });
      expect(resRedesignKw.scope).toBe('redesign');
      expect(resRedesignKw.autoApplyAllowed).toBe(false);

      // 4. Level 3 (Redesign) via failed attempts limit
      const resRedesignLimit = await evaluateRepairScope({
        workflowJson: basicWorkflow,
        failedAttempts: 3,
        executionResult: { runData: {} }
      });
      expect(resRedesignLimit.scope).toBe('redesign');
      expect(resRedesignLimit.autoApplyAllowed).toBe(false);
    });

    it('prepare_refactor_plan creates a delegation request for workflow refactoring', async () => {
      const testWorkflow = { name: 'CRM Sync', nodes: [], connections: {}, settings: {} };
      const plan = await prepareRefactorPlan({
        workflowJson: testWorkflow,
        reason: 'Missing data validation set nodes'
      });

      expect(plan.mode).toBe('delegated');
      expect(plan.refactorRequired).toBe(true);
      expect(plan.recommendedMcpTool).toBe('design_workflow');
      expect(plan.recommendedMcpArguments.description).toContain('Missing data validation set nodes');
      expect(plan.instructions).toContain('design_workflow');
    });

    it('prepare_redesign_plan suggests structural architectural changes', async () => {
      const testWorkflow = {
        name: 'Webhook Trigger Workflow',
        nodes: [{ name: 'Webhook', type: 'n8n-nodes-base.webhook' }],
        connections: {},
        settings: {}
      };

      // Test webhook/polling redesign
      const planWeb = await prepareRedesignPlan({
        workflowJson: testWorkflow,
        reason: 'Change to polling trigger since webhooks are blocked'
      });
      expect(planWeb.redesignRequired).toBe(true);
      expect(planWeb.newApproach).toContain('Polling');
      expect(planWeb.migrationImpact.requiresNewWebhookUrl).toBe(true);
      expect(planWeb.requiresUserApproval).toBe(true);

      // Test credentials redesign
      const planCred = await prepareRedesignPlan({
        workflowJson: testWorkflow,
        reason: 'Missing auth credentials'
      });
      expect(planCred.newApproach).toContain('authorization layers');
      expect(planCred.migrationImpact.requiresTestCredentials).toBe(true);
    });

    it('generate_workflow_variant applies modifications and returns variant', async () => {
      const baseWorkflow = {
        name: 'Original Workflow',
        nodes: [
          { name: 'My Webhook', type: 'n8n-nodes-base.webhook' },
          { name: 'Bitrix24 CRM', type: 'n8n-nodes-base.bitrix24', parameters: { id: '123' } }
        ],
        connections: {},
        settings: {}
      };

      const result = await generateWorkflowVariant({
        workflowJson: baseWorkflow,
        variantName: 'Redesigned Polling Variant',
        modifications: [
          {
            type: 'change_trigger',
            newNode: { name: 'My Polling', type: 'n8n-nodes-base.pollingTrigger' }
          },
          {
            type: 'replace_node',
            targetNode: 'Bitrix24 CRM',
            newNode: { parameters: { id: '456', mode: 'update' } }
          },
          {
            type: 'add_node',
            newNode: { name: 'New Helper Node', type: 'n8n-nodes-base.set' }
          }
        ]
      });

      expect(result.success).toBe(true);
      expect(result.variantWorkflowJson.name).toBe('Redesigned Polling Variant');
      expect(result.variantWorkflowJson.nodes[0].name).toBe('My Polling');
      expect(result.variantWorkflowJson.nodes[1].parameters.id).toBe('456');
      expect(result.variantWorkflowJson.nodes[1].parameters.mode).toBe('update');
      expect(result.variantWorkflowJson.nodes[2].name).toBe('New Helper Node');
    });

    it('compare_workflow_variants detects added, removed, and modified components', async () => {
      const v1 = {
        nodes: [
          { name: 'Node A', parameters: { val: '1' } },
          { name: 'Node B', parameters: { val: '2' } }
        ]
      };
      const v2 = {
        nodes: [
          { name: 'Node A', parameters: { val: 'updated_val', extra: '3' } },
          { name: 'Node C', parameters: {} }
        ]
      };

      const comparison = await compareWorkflowVariants({
        workflowJsonV1: v1,
        workflowJsonV2: v2
      });

      expect(comparison.differenceDetected).toBe(true);
      expect(comparison.addedNodes).toContain('Node C');
      expect(comparison.removedNodes).toContain('Node B');
      expect(comparison.modifiedParameters.length).toBe(2);
      expect(comparison.modifiedParameters.find(p => p.path === 'parameters.val')?.v2).toBe('updated_val');
      expect(comparison.modifiedParameters.find(p => p.path === 'parameters.extra')?.v2).toBe('3');
      expect(comparison.comparisonSummary).toContain('added 1 nodes, removed 1 nodes, and modified 2 parameters');
    });

    it('prepare_migration_plan produces deployment and rollback steps', async () => {
      const v1 = {
        name: 'Sync Flow',
        nodes: [{ name: 'Webhook', type: 'n8n-nodes-base.webhook' }],
        connections: {},
        settings: {}
      };
      const v2 = {
        name: 'Sync Flow v2',
        nodes: [{ name: 'Polling', type: 'n8n-nodes-base.pollingTrigger' }],
        connections: {},
        settings: {}
      };

      const plan = await prepareMigrationPlan({
        productionWorkflowId: 'prod-uuid-999',
        workflowJsonV1: v1,
        workflowJsonV2: v2
      });

      expect(plan.mode).toBe('delegated');
      expect(plan.breakingChanges.length).toBe(1);
      expect(plan.breakingChanges[0]).toContain('Trigger type changed');
      expect(plan.deploymentSteps.some(s => s.includes('prod-uuid-999'))).toBe(true);
      expect(plan.rollbackPlan.some(s => s.includes('prod-uuid-999'))).toBe(true);
      expect(plan.recommendedMcpTool).toBe('n8n_update_full_workflow');
      expect(plan.recommendedMcpArguments.id).toBe('prod-uuid-999');
      expect(plan.instructions).toContain('n8n_update_full_workflow');
    });
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
