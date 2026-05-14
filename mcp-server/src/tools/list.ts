import type { IWorkflowBase } from 'n8n-workflow';

type N8nApiWorkflow = Partial<IWorkflowBase> & Record<string, unknown>;

export async function listWorkflows(baseUrl: string, apiKey: string): Promise<N8nApiWorkflow[] | unknown> {
  return n8nFetch(`${baseUrl}/api/v1/workflows`, apiKey);
}

export async function getWorkflow(workflowId: string, baseUrl: string, apiKey: string): Promise<N8nApiWorkflow | unknown> {
  if (!workflowId) {
    throw new Error('workflowId is required.');
  }

  return n8nFetch(`${baseUrl}/api/v1/workflows/${workflowId}`, apiKey);
}

async function n8nFetch(url: string, apiKey: string): Promise<unknown> {
  if (!apiKey) {
    throw new Error('N8N_API_KEY is required to call the n8n API.');
  }

  const response = await fetch(url, {
    headers: { 'X-N8N-API-KEY': apiKey },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`n8n API ${response.status}: ${body}`);
  }

  return body ? JSON.parse(body) : {};
}
