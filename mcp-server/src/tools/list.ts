import type { IWorkflowBase } from 'n8n-workflow';
import { n8nApiRequest, n8nPath } from './n8n-api.js';

type N8nApiWorkflow = Partial<IWorkflowBase> & Record<string, unknown>;

export async function listWorkflows(baseUrl: string, apiKey: string): Promise<N8nApiWorkflow[] | unknown> {
  return n8nApiRequest({ baseUrl, apiKey }, { path: '/workflows' });
}

export async function getWorkflow(workflowId: string, baseUrl: string, apiKey: string): Promise<N8nApiWorkflow | unknown> {
  if (!workflowId) {
    throw new Error('workflowId is required.');
  }

  return n8nApiRequest({ baseUrl, apiKey }, { path: n8nPath`/workflows/${workflowId}` });
}
