import type { WorkflowJSON } from '@n8n/workflow-sdk';
import type { IWorkflowBase } from 'n8n-workflow';

type N8nApiWorkflow = Partial<WorkflowJSON> & {
  tags?: unknown;
  [key: string]: unknown;
};

type N8nWorkflowResponse = Partial<IWorkflowBase> & N8nApiWorkflow;

interface WorkflowListResponse {
  data?: N8nWorkflowResponse[];
}

const DEPLOY_ALLOWED_SETTINGS = new Set([
  'executionOrder',
  'errorWorkflow',
  'timezone',
  'saveManualExecutions',
  'saveDataErrorExecution',
  'saveExecutionProgress',
  'callerPolicy',
]);

export interface DeployWorkflowArgs {
  workflowJson: N8nApiWorkflow;
  activate?: boolean;
  updateExisting?: boolean;
}

export async function deployWorkflow(
  args: DeployWorkflowArgs,
  baseUrl: string,
  apiKey: string,
): Promise<Record<string, unknown>> {
  if (!apiKey) {
    throw new Error('N8N_API_KEY is required to deploy workflows.');
  }

  const workflow = sanitizeWorkflowForDeploy(args.workflowJson);
  const existingWorkflow = args.updateExisting === false ? undefined : await findWorkflowByName(baseUrl, apiKey, workflow.name);
  const workflowResult = existingWorkflow?.id
    ? await n8nFetch(`${baseUrl}/api/v1/workflows/${String(existingWorkflow.id)}`, apiKey, {
      method: 'PATCH',
      body: JSON.stringify(workflow),
    })
    : await n8nFetch(`${baseUrl}/api/v1/workflows`, apiKey, {
      method: 'POST',
      body: JSON.stringify(workflow),
    });

  if (args.activate && typeof workflowResult === 'object' && workflowResult && 'id' in workflowResult) {
    await n8nFetch(`${baseUrl}/api/v1/workflows/${String(workflowResult.id)}/activate`, apiKey, { method: 'POST' });
  }

  return {
    deployed: true,
    mode: existingWorkflow?.id ? 'updated' : 'created',
    activated: Boolean(args.activate),
    workflow: workflowResult,
  };
}

function sanitizeWorkflowForDeploy(workflowJson: N8nApiWorkflow): N8nApiWorkflow {
  const {
    id: _id,
    active: _active,
    tags: _tags,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
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

  const response = await n8nFetch(`${baseUrl}/api/v1/workflows`, apiKey, { method: 'GET' });
  const workflows = workflowListFromResponse(response);
  return workflows.find((workflow) => workflow.name === name);
}

function workflowListFromResponse(response: unknown): N8nWorkflowResponse[] {
  if (Array.isArray(response)) {
    return response.filter(isObjectRecord) as N8nWorkflowResponse[];
  }
  if (isObjectRecord(response)) {
    const data = (response as WorkflowListResponse).data;
    if (Array.isArray(data)) {
      return data.filter(isObjectRecord) as N8nWorkflowResponse[];
    }
  }
  return [];
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function n8nFetch(url: string, apiKey: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'X-N8N-API-KEY': apiKey,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`n8n API ${response.status}: ${body}`);
  }

  return body ? JSON.parse(body) : {};
}
