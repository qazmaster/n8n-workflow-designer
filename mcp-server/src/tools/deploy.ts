interface DeployWorkflowArgs {
  workflowJson: Record<string, unknown>;
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
  const created = await n8nFetch(`${baseUrl}/api/v1/workflows`, apiKey, {
    method: 'POST',
    body: JSON.stringify(workflow),
  });

  if (args.activate && typeof created === 'object' && created && 'id' in created) {
    await n8nFetch(`${baseUrl}/api/v1/workflows/${String(created.id)}/activate`, apiKey, { method: 'POST' });
  }

  return { deployed: true, activated: Boolean(args.activate), workflow: created };
}

function sanitizeWorkflowForDeploy(workflowJson: Record<string, unknown>): Record<string, unknown> {
  const workflow = { ...workflowJson };
  delete workflow.id;
  delete workflow.active;
  delete workflow.tags;
  delete workflow.createdAt;
  delete workflow.updatedAt;
  return workflow;
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
