import type { WorkflowJSON } from '@n8n/workflow-sdk';
import type { IWorkflowBase } from 'n8n-workflow';
import { isObjectRecord, listFromN8nResponse, n8nApiRequest, n8nPath, redactSensitiveData } from './n8n-api.js';

type N8nApiWorkflow = Partial<WorkflowJSON> & {
  tags?: unknown;
  [key: string]: unknown;
};

type N8nWorkflowResponse = Partial<IWorkflowBase> & N8nApiWorkflow;

const DEPLOY_ALLOWED_SETTINGS = new Set([
  'executionOrder',
  'errorWorkflow',
  'timezone',
  'saveManualExecutions',
  'saveDataErrorExecution',
  'saveExecutionProgress',
  'callerPolicy',
]);

export type DeployMode = 'upsert-by-name' | 'update-by-id' | 'create';

export interface DeployWorkflowArgs {
  workflowJson: N8nApiWorkflow;
  activate?: boolean;
  updateExisting?: boolean;
  workflowId?: string;
  mode?: DeployMode;
  dryRun?: boolean;
  confirmMutation?: boolean;
}

export async function deployWorkflow(
  args: DeployWorkflowArgs,
  baseUrl: string,
  apiKey: string,
): Promise<Record<string, unknown>> {
  const workflow = sanitizeWorkflowForDeploy(args.workflowJson);
  const mode = resolveDeployMode(args);

  if (args.dryRun) {
    return {
      deployed: false,
      dryRun: true,
      mode: mode === 'update-by-id' ? 'updated' : mode === 'create' ? 'created' : 'upsert-planned',
      updateStrategy: mode,
      workflowId: mode === 'update-by-id' ? args.workflowId : undefined,
      workflow: redactSensitiveData(workflow),
    };
  }

  if (!apiKey) {
    throw new Error('N8N_API_KEY is required to deploy workflows.');
  }
  if (!args.confirmMutation) {
    throw new Error('confirmMutation must be true to create, update, or activate workflows. Use dryRun: true to inspect the payload without mutating n8n.');
  }

  const existingWorkflow = mode === 'upsert-by-name' ? await findWorkflowByName(baseUrl, apiKey, workflow.name) : undefined;
  const targetWorkflowId = mode === 'update-by-id' ? args.workflowId : stringId(existingWorkflow?.id);
  const resolvedMode: 'created' | 'updated' = targetWorkflowId ? 'updated' : 'created';

  const workflowResult = targetWorkflowId
    ? await n8nApiRequest({ baseUrl, apiKey }, { method: 'PATCH', path: n8nPath`/workflows/${targetWorkflowId}`, body: workflow })
    : await n8nApiRequest({ baseUrl, apiKey }, { method: 'POST', path: '/workflows', body: workflow });

  if (args.activate && typeof workflowResult === 'object' && workflowResult && 'id' in workflowResult) {
    await n8nApiRequest({ baseUrl, apiKey }, { method: 'POST', path: n8nPath`/workflows/${String(workflowResult.id)}/activate` });
  }

  return {
    deployed: true,
    mode: resolvedMode,
    updateStrategy: mode,
    activated: Boolean(args.activate),
    workflow: workflowResult,
  };
}

function resolveDeployMode(args: DeployWorkflowArgs): DeployMode {
  if (args.workflowId && args.mode && args.mode !== 'update-by-id') {
    throw new Error('workflowId can only be combined with mode: update-by-id. Remove workflowId or use update-by-id.');
  }
  if (args.mode) {
    if (args.mode === 'update-by-id' && !args.workflowId) {
      throw new Error('workflowId is required when deploy mode is update-by-id.');
    }
    return args.mode;
  }

  if (args.workflowId) {
    return 'update-by-id';
  }
  if (args.updateExisting === false) {
    return 'create';
  }
  return 'upsert-by-name';
}

function sanitizeWorkflowForDeploy(workflowJson: N8nApiWorkflow): N8nApiWorkflow {
  const {
    id: _id,
    active: _active,
    tags: _tags,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    pinData: _pinData,
    staticData: _staticData,
    ...workflow
  } = workflowJson;
  if (isObjectRecord(workflow.settings)) {
    workflow.settings = Object.fromEntries(
      Object.entries(workflow.settings).filter(([key]) => DEPLOY_ALLOWED_SETTINGS.has(key)),
    );
  }
  return workflow;
}

async function findWorkflowByName(baseUrl: string, apiKey: string, name: unknown): Promise<N8nWorkflowResponse | undefined> {
  if (typeof name !== 'string' || name.trim() === '') {
    return undefined;
  }

  const response = await n8nApiRequest({ baseUrl, apiKey }, { method: 'GET', path: '/workflows' });
  const workflows = listFromN8nResponse<N8nWorkflowResponse>(response).filter(isObjectRecord);
  return workflows.find((workflow) => workflow.name === name);
}

function stringId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return undefined;
}
