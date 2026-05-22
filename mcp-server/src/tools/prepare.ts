import type { WorkflowJSON } from '@n8n/workflow-sdk';
import { compileWorkflow } from './compile.js';
import { validateWorkflow, type ValidationResult } from './validate.js';
import { resolveDeployMode, sanitizeWorkflowForDeploy, type DeployMode } from './deploy.js';

export interface PrepareDeployPlanArgs {
  workflowJson?: Record<string, any>;
  typescriptCode?: string;
  filePath?: string;
  activate?: boolean;
  updateExisting?: boolean;
  workflowId?: string;
  mode?: DeployMode;
}

export interface PrepareDeployPlanResult {
  mode: 'delegated';
  strategy: DeployMode;
  workflowId?: string;
  activate: boolean;
  sanitizedWorkflowJson: Record<string, any>;
  validation: ValidationResult;
  recommendedMcpTool: string;
  recommendedMcpArguments: Record<string, any>;
  recommendedNextTool: string;
  requiredTools: string[];
  instructions: string;
}

export async function prepareDeployPlan(args: PrepareDeployPlanArgs): Promise<PrepareDeployPlanResult> {
  let workflowJson = args.workflowJson;

  if (args.typescriptCode || args.filePath) {
    const compiled = await compileWorkflow({
      typescriptCode: args.typescriptCode,
      filePath: args.filePath,
    });
    workflowJson = compiled as unknown as Record<string, any>;
  }

  if (!workflowJson) {
    throw new Error('prepare_deploy_plan requires workflowJson, typescriptCode, or filePath.');
  }

  // Sanitize the workflow JSON
  const sanitizedWorkflow = sanitizeWorkflowForDeploy(workflowJson as any);

  // Validate the workflow JSON
  const validation = await validateWorkflow({
    workflowJson: sanitizedWorkflow,
    schemaValidation: 'known-node-registry',
  });

  // Resolve deploy mode strategy
  const strategy = resolveDeployMode({
    workflowJson: sanitizedWorkflow,
    activate: args.activate,
    updateExisting: args.updateExisting,
    workflowId: args.workflowId,
    mode: args.mode,
  });

  const activate = args.activate ?? false;
  let recommendedMcpTool = 'n8n_create_workflow';
  let recommendedMcpArguments: Record<string, any> = {};
  let instructions = '';
  let requiredTools: string[] = [];
  let recommendedNextTool = '';

  const name = sanitizedWorkflow.name || 'Unnamed Workflow';
  const nodes = sanitizedWorkflow.nodes || [];
  const connections = sanitizedWorkflow.connections || {};
  const settings = sanitizedWorkflow.settings || {};

  if (strategy === 'update-by-id' && args.workflowId) {
    recommendedMcpTool = 'n8n_update_full_workflow';
    recommendedMcpArguments = {
      id: args.workflowId,
      name,
      nodes,
      connections,
      settings,
      intent: `Deploy update for workflow ${args.workflowId}`,
    };
    instructions = `Execute the mutation using czlonkowski/n8n-mcp: call n8n_update_full_workflow with the recommended arguments.`;
    requiredTools = ['n8n_update_full_workflow'];
    recommendedNextTool = 'n8n_update_full_workflow';
  } else if (strategy === 'create') {
    recommendedMcpTool = 'n8n_create_workflow';
    recommendedMcpArguments = {
      name,
      nodes,
      connections,
      settings,
    };
    instructions = `Execute the mutation using czlonkowski/n8n-mcp: call n8n_create_workflow with the recommended arguments. Note that workflows are created inactive by default. If activate was set to true, you will need to activate the workflow separately after creation.`;
    requiredTools = ['n8n_create_workflow'];
    recommendedNextTool = 'n8n_create_workflow';
  } else {
    // upsert-by-name
    recommendedMcpTool = 'n8n_create_workflow';
    recommendedMcpArguments = {
      name,
      nodes,
      connections,
      settings,
    };
    instructions = `Check if a workflow named "${name}" already exists using n8n-mcp.n8n_list_workflows({ name: "${name}" }).\n` +
      `- If it exists, call n8n_update_full_workflow using its ID, name, and the nodes/connections/settings from recommendedMcpArguments.\n` +
      `- If it does not exist, call n8n_create_workflow with the recommended arguments.\n` +
      `Note: If activate was set to true, remember to activate the workflow after creation/update.`;
    requiredTools = ['n8n_list_workflows', 'n8n_create_workflow', 'n8n_update_full_workflow'];
    recommendedNextTool = 'n8n_list_workflows';
  }

  const haltInstruction = `\n\nCRITICAL: Before calling the recommended tool, check if the required n8n-mcp tools (${requiredTools.join(', ')}) are configured and available in your environment. If they are missing or if the backend cannot be reached, STOP immediately and ask the user to configure or connect their n8n-mcp server (which may be local, remote self-hosted, or hosted).`;
  instructions += haltInstruction;

  return {
    mode: 'delegated',
    strategy,
    workflowId: args.workflowId,
    activate,
    sanitizedWorkflowJson: sanitizedWorkflow,
    validation,
    recommendedMcpTool,
    recommendedMcpArguments,
    recommendedNextTool,
    requiredTools,
    instructions,
  };
}

export interface PrepareExecutionPlanArgs {
  workflowId: string;
  endpoint?: 'execute' | 'run';
  inputData?: any;
  triggerType?: string;
  message?: string;
}

export interface PrepareExecutionPlanResult {
  mode: 'delegated';
  workflowId: string;
  endpoint: 'execute' | 'run';
  recommendedMcpTool: string;
  recommendedMcpArguments: Record<string, any>;
  recommendedNextTool: string;
  requiredTools: string[];
  instructions: string;
}

export async function prepareExecutionPlan(args: PrepareExecutionPlanArgs): Promise<PrepareExecutionPlanResult> {
  if (!args.workflowId) {
    throw new Error('prepare_execution_plan requires workflowId.');
  }

  const endpoint = args.endpoint || 'execute';
  const recommendedMcpTool = 'n8n_test_workflow';
  const recommendedMcpArguments: Record<string, any> = {
    workflowId: args.workflowId,
  };
  if (args.triggerType !== undefined) {
    recommendedMcpArguments.triggerType = args.triggerType;
  }
  if (args.inputData !== undefined) {
    recommendedMcpArguments.data = args.inputData;
  }
  if (args.message !== undefined) {
    recommendedMcpArguments.message = args.message;
  }

  const requiredTools = ['n8n_test_workflow'];
  const recommendedNextTool = 'n8n_test_workflow';

  let instructions = `Trigger/test the workflow execution using czlonkowski/n8n-mcp: call n8n_test_workflow with the recommended arguments.`;
  const haltInstruction = `\n\nCRITICAL: Before calling the recommended tool, check if the required n8n-mcp tools (${requiredTools.join(', ')}) are configured and available in your environment. If they are missing or if the backend cannot be reached, STOP immediately and ask the user to configure or connect their n8n-mcp server (which may be local, remote self-hosted, or hosted).`;
  instructions += haltInstruction;

  return {
    mode: 'delegated',
    workflowId: args.workflowId,
    endpoint,
    recommendedMcpTool,
    recommendedMcpArguments,
    recommendedNextTool,
    requiredTools,
    instructions,
  };
}

export interface PrepareImportPlanArgs extends PrepareDeployPlanArgs {}
export interface PrepareImportPlanResult extends PrepareDeployPlanResult {}

export async function prepareImportPlan(args: PrepareImportPlanArgs): Promise<PrepareImportPlanResult> {
  if (!args.workflowJson) {
    throw new Error('prepare_import_plan requires workflowJson.');
  }
  return prepareDeployPlan(args);
}

export interface PrepareExportPlanArgs {
  workflowId: string;
  includeMetadata?: boolean;
}

export interface PrepareExportPlanResult {
  mode: 'delegated';
  workflowId: string;
  includeMetadata: boolean;
  recommendedMcpTool: string;
  recommendedMcpArguments: Record<string, any>;
  recommendedNextTool: string;
  requiredTools: string[];
  instructions: string;
}

export async function prepareExportPlan(args: PrepareExportPlanArgs): Promise<PrepareExportPlanResult> {
  if (!args.workflowId) {
    throw new Error('prepare_export_plan requires workflowId.');
  }

  const includeMetadata = args.includeMetadata ?? false;
  const recommendedMcpTool = 'n8n_get_workflow';
  const recommendedMcpArguments = {
    id: args.workflowId,
    mode: 'full',
  };

  const requiredTools = ['n8n_get_workflow'];
  const recommendedNextTool = 'n8n_get_workflow';

  let instructions = `Fetch the workflow JSON using czlonkowski/n8n-mcp by calling n8n_get_workflow with the recommended arguments.\n` +
    `- Note: If includeMetadata was set to false, you should post-process the retrieved workflow JSON by removing metadata fields (such as createdAt, updatedAt, shared, usedCredentials, pinData, staticData).\n` +
    `- Run n8n-workflow-designer's validate_workflow tool on the returned JSON to verify it offline.`;

  const haltInstruction = `\n\nCRITICAL: Before calling the recommended tool, check if the required n8n-mcp tools (${requiredTools.join(', ')}) are configured and available in your environment. If they are missing or if the backend cannot be reached, STOP immediately and ask the user to configure or connect their n8n-mcp server (which may be local, remote self-hosted, or hosted).`;
  instructions += haltInstruction;

  return {
    mode: 'delegated',
    workflowId: args.workflowId,
    includeMetadata,
    recommendedMcpTool,
    recommendedMcpArguments,
    recommendedNextTool,
    requiredTools,
    instructions,
  };
}
