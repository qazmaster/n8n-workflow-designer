import { isObjectRecord, n8nApiRequest, n8nPath, redactSensitiveData } from './n8n-api.js';

export interface ExecuteWorkflowArgs {
  workflowId: string;
  workflowData?: Record<string, unknown>;
  startNodes?: string[];
  destinationNode?: string;
  inputData?: unknown;
  endpoint?: 'execute' | 'run';
  waitForCompletion?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
  confirmMutation?: boolean;
}

export async function executeWorkflow(
  args: ExecuteWorkflowArgs,
  baseUrl: string,
  apiKey: string,
): Promise<Record<string, unknown>> {
  if (!args.workflowId) {
    throw new Error('workflowId is required.');
  }
  if (!args.confirmMutation) {
    throw new Error('confirmMutation must be true to execute workflows. Workflow execution can trigger external side effects.');
  }

  const endpoint = args.endpoint || 'execute';
  const result = await n8nApiRequest({ baseUrl, apiKey }, {
    method: 'POST',
    path: n8nPath`/workflows/${args.workflowId}/${endpoint}`,
    body: buildExecuteBody(args, endpoint),
  });

  const executionId = executionIdFromResult(result);
  if (!args.waitForCompletion || !executionId) {
    return {
      executed: true,
      endpoint,
      workflowId: args.workflowId,
      result: redactSensitiveData(result),
    };
  }

  const execution = await pollExecution({
    executionId,
    baseUrl,
    apiKey,
    pollIntervalMs: args.pollIntervalMs || 1000,
    timeoutMs: args.timeoutMs || 30000,
  });

  return {
    executed: true,
    endpoint,
    workflowId: args.workflowId,
    executionId,
    result: redactSensitiveData(result),
    execution: redactSensitiveData(execution),
  };
}

function buildExecuteBody(args: ExecuteWorkflowArgs, endpoint: 'execute' | 'run'): Record<string, unknown> | undefined {
  if (endpoint === 'execute') {
    const body: Record<string, unknown> = {};
    if (args.inputData !== undefined) {
      body.inputData = args.inputData;
    }
    return Object.keys(body).length > 0 ? body : undefined;
  }

  const body: Record<string, unknown> = {};
  if (args.workflowData) {
    body.workflowData = args.workflowData;
  }
  if (args.startNodes) {
    body.startNodes = args.startNodes;
  }
  if (args.destinationNode) {
    body.destinationNode = args.destinationNode;
  }
  if (args.inputData !== undefined) {
    body.inputData = args.inputData;
  }
  return body;
}

interface PollExecutionArgs {
  executionId: string;
  baseUrl: string;
  apiKey: string;
  pollIntervalMs: number;
  timeoutMs: number;
}

async function pollExecution(args: PollExecutionArgs): Promise<unknown> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= args.timeoutMs) {
    const execution = await n8nApiRequest({ baseUrl: args.baseUrl, apiKey: args.apiKey }, { path: n8nPath`/executions/${args.executionId}` });
    if (!isRunningExecution(execution)) {
      return execution;
    }
    await delay(args.pollIntervalMs);
  }
  throw new Error(`Timed out waiting for execution ${args.executionId}.`);
}

function executionIdFromResult(result: unknown): string | undefined {
  if (!isObjectRecord(result)) {
    return undefined;
  }
  const executionId = result.executionId || result.id;
  if (typeof executionId === 'string') {
    return executionId;
  }
  if (typeof executionId === 'number') {
    return String(executionId);
  }
  return undefined;
}

function isRunningExecution(execution: unknown): boolean {
  if (!isObjectRecord(execution)) {
    return false;
  }
  const status = execution.status;
  if (typeof status === 'string') {
    return ['new', 'running', 'waiting'].includes(status.toLowerCase());
  }
  if (typeof execution.finished === 'boolean') {
    return !execution.finished;
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
