import type { WorkflowJSON } from '@n8n/workflow-sdk';
import { deployWorkflow, type DeployMode } from './deploy.js';
import { listFromN8nResponse, n8nApiRequest, n8nPath, redactSensitiveData } from './n8n-api.js';

type N8nApiWorkflow = Partial<WorkflowJSON> & Record<string, unknown>;

export interface ExportWorkflowArgs {
  workflowId: string;
  includeMetadata?: boolean;
}

export interface ImportWorkflowArgs {
  workflowJson: N8nApiWorkflow;
  workflowId?: string;
  mode?: DeployMode;
  activate?: boolean;
  dryRun?: boolean;
  confirmMutation?: boolean;
}

export async function exportWorkflow(
  args: ExportWorkflowArgs,
  baseUrl: string,
  apiKey: string,
): Promise<Record<string, unknown>> {
  if (!args.workflowId) {
    throw new Error('workflowId is required.');
  }

  const workflow = await n8nApiRequest<N8nApiWorkflow>({ baseUrl, apiKey }, { path: n8nPath`/workflows/${args.workflowId}` });
  return {
    exported: true,
    workflowId: args.workflowId,
    workflow: redactSensitiveData(args.includeMetadata ? workflow : stripExportMetadata(workflow)),
  };
}

export async function importWorkflow(
  args: ImportWorkflowArgs,
  baseUrl: string,
  apiKey: string,
): Promise<Record<string, unknown>> {
  return deployWorkflow({
    workflowJson: args.workflowJson,
    workflowId: args.workflowId,
    mode: args.mode,
    activate: args.activate,
    dryRun: args.dryRun,
    confirmMutation: args.confirmMutation,
  }, baseUrl, apiKey);
}

export async function listCredentials(baseUrl: string, apiKey: string): Promise<Record<string, unknown>> {
  const response = await n8nApiRequest({ baseUrl, apiKey }, { path: '/credentials' });
  return {
    credentials: listFromN8nResponse<Record<string, unknown>>(response).map((credential) => redactSensitiveData(redactCredential(credential))),
  };
}

export async function listCommunityPackages(baseUrl: string, apiKey: string): Promise<Record<string, unknown>> {
  const response = await n8nApiRequest({ baseUrl, apiKey }, { path: '/community-packages' });
  return {
    packages: listFromN8nResponse<Record<string, unknown>>(response),
  };
}

function stripExportMetadata(workflow: N8nApiWorkflow): N8nApiWorkflow {
  const {
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    shared: _shared,
    usedCredentials: _usedCredentials,
    pinData: _pinData,
    staticData: _staticData,
    ...portableWorkflow
  } = workflow;
  return portableWorkflow;
}

function redactCredential(credential: Record<string, unknown>): Record<string, unknown> {
  const { data: _data, ...safeCredential } = credential;
  return safeCredential;
}
