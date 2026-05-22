import { compileWorkflow } from './compile.js';
import { sanitizeWorkflowForDeploy } from './deploy.js';
import type { TestContract } from './test-contract.js';

export interface PrepareSandboxDeployPlanArgs {
  workflowJson?: Record<string, any>;
  typescriptCode?: string;
  filePath?: string;
  sandboxWorkflowId?: string;
  sandboxSuffix?: string;
}

export interface PrepareSandboxDeployPlanResult {
  mode: 'delegated';
  target: 'sandbox';
  workflowName: string;
  active: boolean;
  tags: string[];
  credentialsPolicy: 'test-only';
  cleanupPolicy: 'delete-after-pass-or-ttl';
  sanitizedWorkflowJson: Record<string, any>;
  recommendedMcpTool: string;
  recommendedMcpArguments: Record<string, any>;
  recommendedNextTool: string;
  requiredTools: string[];
  instructions: string;
}

export async function prepareSandboxDeployPlan(args: PrepareSandboxDeployPlanArgs): Promise<PrepareSandboxDeployPlanResult> {
  let workflowJson = args.workflowJson;

  if (args.typescriptCode || args.filePath) {
    const compiled = await compileWorkflow({
      typescriptCode: args.typescriptCode,
      filePath: args.filePath,
    });
    workflowJson = compiled as unknown as Record<string, any>;
  }

  if (!workflowJson) {
    throw new Error('prepare_sandbox_deploy_plan requires workflowJson, typescriptCode, or filePath.');
  }

  // Sanitize for deployment
  const sanitized = sanitizeWorkflowForDeploy(workflowJson as any);

  // Override details for sandbox
  const suffix = args.sandboxSuffix || '_sandbox';
  const originalName = sanitized.name || 'Unnamed Workflow';
  const workflowName = originalName.startsWith('[TEST]')
    ? originalName
    : `[TEST] ${originalName}${originalName.endsWith(suffix) ? '' : suffix}`;

  sanitized.name = workflowName;
  sanitized.active = false; // Always inactive/test clone

  // Ensure tags is array and contains our specific tags
  const defaultTags = ['ai-generated', 'test', 'do-not-use-production'];
  const currentTags = Array.isArray((sanitized as any).tags) ? (sanitized as any).tags : [];
  (sanitized as any).tags = Array.from(new Set([...currentTags, ...defaultTags]));

  const recommendedMcpTool = args.sandboxWorkflowId ? 'n8n_update_full_workflow' : 'n8n_create_workflow';
  const recommendedMcpArguments: Record<string, any> = {
    name: workflowName,
    nodes: sanitized.nodes || [],
    connections: sanitized.connections || {},
    settings: sanitized.settings || {},
  };

  if (args.sandboxWorkflowId) {
    recommendedMcpArguments.id = args.sandboxWorkflowId;
    recommendedMcpArguments.intent = `Deploy sandbox update for test clone ${args.sandboxWorkflowId}`;
  }

  const requiredTools = args.sandboxWorkflowId
    ? ['n8n_update_full_workflow']
    : ['n8n_list_workflows', 'n8n_create_workflow', 'n8n_update_full_workflow'];

  const recommendedNextTool = args.sandboxWorkflowId
    ? 'n8n_update_full_workflow'
    : 'n8n_list_workflows';

  let instructions = '';
  if (args.sandboxWorkflowId) {
    instructions = `Execute the sandbox mutation using czlonkowski/n8n-mcp: call n8n_update_full_workflow to update the sandbox/test workflow clone with ID "${args.sandboxWorkflowId}".`;
  } else {
    instructions = `Check if a test clone named "${workflowName}" already exists using n8n-mcp.n8n_list_workflows({ name: "${workflowName}" }).\n` +
      `- If it exists, call n8n_update_full_workflow using its ID, name, and nodes/connections/settings from recommendedMcpArguments.\n` +
      `- If it does not exist, call n8n_create_workflow with the recommended arguments.\n` +
      `Note: Ensure the deployed workflow remains inactive during testing.`;
  }

  const haltInstruction = `\n\nCRITICAL: Before calling the recommended tool, check if the required n8n-mcp tools (${requiredTools.join(', ')}) are configured and available in your environment. If they are missing or if the backend cannot be reached, STOP immediately and ask the user to configure or connect their n8n-mcp server (which may be local, remote self-hosted, or hosted).`;
  instructions += haltInstruction;

  return {
    mode: 'delegated',
    target: 'sandbox',
    workflowName,
    active: false,
    tags: defaultTags,
    credentialsPolicy: 'test-only',
    cleanupPolicy: 'delete-after-pass-or-ttl',
    sanitizedWorkflowJson: sanitized,
    recommendedMcpTool,
    recommendedMcpArguments,
    recommendedNextTool,
    requiredTools,
    instructions,
  };
}

export interface PrepareExecutionSuiteArgs {
  workflowId: string;
  contract: TestContract;
}

export interface SuiteTestCaseExecution {
  id: string;
  description?: string;
  recommendedMcpTool: string;
  recommendedMcpArguments: Record<string, any>;
  assertions: any[];
}

export interface PrepareExecutionSuiteResult {
  mode: 'delegated';
  workflowId: string;
  testCases: SuiteTestCaseExecution[];
  requiredTools: string[];
  recommendedNextTool: string;
  instructions: string;
}

export async function prepareExecutionSuite(args: PrepareExecutionSuiteArgs): Promise<PrepareExecutionSuiteResult> {
  const { workflowId, contract } = args;
  if (!workflowId) {
    throw new Error('prepare_execution_suite requires workflowId.');
  }
  if (!contract || !Array.isArray(contract.testCases)) {
    throw new Error('prepare_execution_suite requires a valid contract with testCases.');
  }

  const testCases: SuiteTestCaseExecution[] = [];

  for (const tc of contract.testCases) {
    const recommendedMcpArguments: Record<string, any> = {
      workflowId,
    };
    if (tc.input) {
      recommendedMcpArguments.data = tc.input.body || tc.input.message || tc.input;
    }

    const assertions: any[] = [];
    if (tc.expected) {
      const finalNodeName = tc.expected.pathExists
        ? tc.expected.pathExists[tc.expected.pathExists.length - 1]
        : undefined;

      assertions.push({
        testCaseId: tc.id,
        nodeName: finalNodeName || 'Prepare Data',
        expectedOutput: tc.expected.finalOutput,
      });
    }

    testCases.push({
      id: tc.id,
      description: (tc as any).description,
      recommendedMcpTool: 'n8n_test_workflow',
      recommendedMcpArguments,
      assertions,
    });
  }

  const requiredTools = ['n8n_test_workflow'];
  const recommendedNextTool = 'n8n_test_workflow';
  const instructions = `Execute the execution suite on the sandbox/test workflow clone (ID: "${workflowId}"):\n` +
    `1. Call n8n_test_workflow for each test case listed below using the recommended arguments.\n` +
    `2. Capture each execution log/result from the tool response or via n8n_executions.\n` +
    `3. Pass the execution results and assertions to the evaluate_execution_result tool.\n` +
    `4. If any test case fails, call prepare_repair_patch to diagnose the issue.\n\n` +
    `CRITICAL: Before calling the recommended tool, check if the required n8n-mcp tools (${requiredTools.join(', ')}) are configured and available in your environment. If they are missing or if the backend cannot be reached, STOP immediately and ask the user to configure or connect their n8n-mcp server.`;

  return {
    mode: 'delegated',
    workflowId,
    testCases,
    requiredTools,
    recommendedNextTool,
    instructions,
  };
}

function findExpressionInParams(obj: any, varName: string, currentPath: string = 'parameters'): { path: string, value: string } | null {
  if (typeof obj === 'string') {
    if (obj.includes('{{') && obj.includes('}}') && obj.includes(varName)) {
      return { path: currentPath, value: obj };
    }
  } else if (obj && typeof obj === 'object') {
    for (const key in obj) {
      const res = findExpressionInParams(obj[key], varName, `${currentPath}.${key}`);
      if (res) return res;
    }
  }
  return null;
}

function findPathInShape(obj: any, targetKey: string, currentPath: string = '$json'): string | null {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.hasOwnProperty(targetKey)) {
    return `${currentPath}.${targetKey}`;
  }
  for (const key in obj) {
    const nested = findPathInShape(obj[key], targetKey, `${currentPath}.${key}`);
    if (nested) return nested;
  }
  return null;
}

export interface PrepareRepairPatchArgs {
  workflowJson: Record<string, any>;
  executionResult: any;
  failedNodeName?: string;
  errorMessage?: string;
}

export interface PrepareRepairPatchResult {
  status: 'failed';
  failedNode: string;
  errorClass: string;
  message: string;
  observedInputShape: any;
  expectedExpression?: string;
  suspectedCause: string;
  recommendedFix: string;
  recommendedPatch?: {
    type: 'update_node_parameter';
    node: string;
    path: string;
    from: any;
    to: any;
  };
  retestRequired: boolean;
  autoRepairAllowed: boolean;
  safetyReason?: string;
}

export async function prepareRepairPatch(args: PrepareRepairPatchArgs): Promise<PrepareRepairPatchResult> {
  const { workflowJson, executionResult, failedNodeName, errorMessage } = args;

  let failedNode = failedNodeName || 'Unknown Node';
  let message = errorMessage || 'Execution failed without specific error message.';
  let errorClass = 'runtime_error';
  let observedInputShape: any = null;
  let suspectedCause = 'A node execution failed during sandbox testing.';
  let recommendedFix = 'Inspect the node parameters and expressions.';

  const runData = executionResult?.data?.resultData?.runData || {};
  if (runData) {
    for (const nodeName in runData) {
      const runs = runData[nodeName];
      if (Array.isArray(runs)) {
        for (const run of runs) {
          if (run.error) {
            failedNode = nodeName;
            message = run.error.message || message;
            errorClass = run.error.code || 'node_failure';
            observedInputShape = run.data?.main?.[0]?.[0]?.json || null;
            break;
          }
        }
      }
    }
  }

  const lowerMsg = message.toLowerCase();
  let expectedExpression: string | undefined;
  let recommendedPatch: {
    type: 'update_node_parameter';
    node: string;
    path: string;
    from: any;
    to: any;
  } | undefined;

  const nodes = workflowJson.nodes || [];
  const targetNode = nodes.find((n: any) => n.name === failedNode);

  if (lowerMsg.includes('is not defined') || lowerMsg.includes('undefined') || lowerMsg.includes('cannot read property')) {
    errorClass = 'expression_input_shape_mismatch';
    suspectedCause = `An expression references a parameter or path that does not exist in the incoming input stream.`;
    recommendedFix = `Check the input shape of the node "${failedNode}". If previous node outputs nesting, update the expression path (e.g. use '{{ $json.nested.property }}' instead of '{{ $json.property }}').`;

    let varName = '';
    const match = message.match(/(?:property|variable|field)?\s*'?([a-zA-Z0-9_$]+)'?\s+is not defined/i)
               || message.match(/cannot read property\s*'?([a-zA-Z0-9_$]+)'?/i);
    if (match) {
      varName = match[1];
    }

    if (targetNode && varName) {
      const expr = findExpressionInParams(targetNode.parameters, varName);
      if (expr) {
        expectedExpression = expr.value;
        const actualNestedPath = findPathInShape(observedInputShape, varName);
        if (actualNestedPath) {
          recommendedPatch = {
            type: 'update_node_parameter',
            node: failedNode,
            path: expr.path,
            from: expr.value,
            to: `{{ ${actualNestedPath} }}`
          };
        }
      }
    }
  } else if (lowerMsg.includes('credential') || lowerMsg.includes('auth') || lowerMsg.includes('unauthorized') || lowerMsg.includes('api key')) {
    errorClass = 'credential_configuration_error';
    suspectedCause = `Authentication or credential verification failed for node "${failedNode}".`;
    recommendedFix = `Verify that the required credentials are correctly linked in the node settings. Ensure credentials are not hardcoded in parameters.`;
  }

  const forbiddenKeywords = ['credential', 'auth', 'api key', 'token', 'password', 'secret'];
  const isCredentialError = errorClass === 'credential_configuration_error' || forbiddenKeywords.some(kw => message.toLowerCase().includes(kw));

  let autoRepairAllowed = true;
  let safetyReason: string | undefined;

  if (isCredentialError) {
    autoRepairAllowed = false;
    safetyReason = 'Auto-repair is forbidden for credential/authentication issues without manual configuration.';
  }

  return {
    status: 'failed',
    failedNode,
    errorClass,
    message,
    observedInputShape,
    expectedExpression,
    suspectedCause,
    recommendedFix,
    recommendedPatch,
    retestRequired: true,
    autoRepairAllowed,
    safetyReason,
  };
}

export interface ApplyRepairPatchArgs {
  workflowJson: Record<string, any>;
  patch: {
    node: string;
    path: string;
    to: any;
  };
}

export interface ApplyRepairPatchResult {
  workflowJson: Record<string, any>;
  success: boolean;
  message: string;
}

function setValueAtPath(obj: any, path: string, value: any) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

export async function applyRepairPatch(args: ApplyRepairPatchArgs): Promise<ApplyRepairPatchResult> {
  const { workflowJson, patch } = args;
  if (!workflowJson) {
    throw new Error('apply_repair_patch requires workflowJson.');
  }
  if (!patch || !patch.node || !patch.path) {
    throw new Error('apply_repair_patch requires a valid patch with node and path properties.');
  }

  const cleanWorkflow = JSON.parse(JSON.stringify(workflowJson));
  const nodes = cleanWorkflow.nodes || [];
  const targetNode = nodes.find((n: any) => n.name === patch.node);

  if (!targetNode) {
    return {
      workflowJson,
      success: false,
      message: `Node "${patch.node}" not found in workflow.`
    };
  }

  setValueAtPath(targetNode, patch.path, patch.to);

  return {
    workflowJson: cleanWorkflow,
    success: true,
    message: `Successfully applied patch to node "${patch.node}" parameter "${patch.path}".`
  };
}

export interface PrepareRetestPlanArgs {
  sandboxWorkflowId: string;
  workflowJson: Record<string, any>;
}

export interface PrepareRetestPlanResult {
  mode: 'delegated';
  recommendedMcpTool: string;
  recommendedMcpArguments: Record<string, any>;
  recommendedNextTool: string;
  requiredTools: string[];
  instructions: string;
  workflowName: string;
  sanitizedWorkflowJson: Record<string, any>;
}

export async function prepareRetestPlan(args: PrepareRetestPlanArgs): Promise<PrepareRetestPlanResult> {
  const { sandboxWorkflowId, workflowJson } = args;
  if (!sandboxWorkflowId) {
    throw new Error('prepare_retest_plan requires sandboxWorkflowId.');
  }
  if (!workflowJson) {
    throw new Error('prepare_retest_plan requires workflowJson.');
  }

  const recommendedMcpTool = 'n8n_update_full_workflow';
  const recommendedMcpArguments = {
    id: sandboxWorkflowId,
    name: workflowJson.name || 'Test Workflow',
    nodes: workflowJson.nodes || [],
    connections: workflowJson.connections || {},
    settings: workflowJson.settings || {},
    intent: `Retest patched sandbox workflow clone ${sandboxWorkflowId}`
  };

  const requiredTools = ['n8n_update_full_workflow', 'n8n_test_workflow'];
  const recommendedNextTool = 'n8n_update_full_workflow';

  const instructions = `Deploy the patched workflow to the sandbox clone using czlonkowski/n8n-mcp:\n` +
    `1. Call n8n_update_full_workflow with ID "${sandboxWorkflowId}" and the recommended arguments.\n` +
    `2. Rerun the execution test suite using prepare_execution_suite.\n\n` +
    `CRITICAL: Before calling the recommended tool, check if the required n8n-mcp tools (${requiredTools.join(', ')}) are configured and available in your environment. If they are missing or if the backend cannot be reached, STOP immediately and ask the user to configure or connect their n8n-mcp server.`;

  return {
    mode: 'delegated',
    recommendedMcpTool,
    recommendedMcpArguments,
    recommendedNextTool,
    requiredTools,
    instructions,
    workflowName: workflowJson.name || 'Test Workflow',
    sanitizedWorkflowJson: workflowJson
  };
}


export interface PreparePromotionPlanArgs {
  testWorkflowId: string;
  productionWorkflowId?: string;
  workflowJson: Record<string, any>;
  gates: {
    staticValidation: 'passed' | 'failed';
    sandboxExecutions: 'passed' | 'failed';
    credentialPolicy: 'passed' | 'failed';
    noTestArtifacts: 'passed' | 'failed';
  };
}

export interface PreparePromotionPlanResult {
  promotionAllowed: boolean;
  failedGates?: string[];
  source?: {
    testWorkflowId: string;
    sourceWorkflowHash: string;
  };
  target?: {
    mode: 'upsert-by-name' | 'update-by-id' | 'create';
    productionWorkflowId?: string;
  };
  sanitizedWorkflowJson?: Record<string, any>;
  recommendedMcpTool?: string;
  recommendedMcpArguments?: Record<string, any>;
  recommendedNextTool?: string;
  requiredTools?: string[];
  instructions: string;
}

export async function preparePromotionPlan(args: PreparePromotionPlanArgs): Promise<PreparePromotionPlanResult> {
  const { testWorkflowId, productionWorkflowId, workflowJson, gates } = args;

  if (!testWorkflowId) {
    throw new Error('prepare_promotion_plan requires testWorkflowId.');
  }
  if (!workflowJson) {
    throw new Error('prepare_promotion_plan requires workflowJson.');
  }

  const failedGates = Object.entries(gates)
    .filter(([_, status]) => status !== 'passed')
    .map(([gateName]) => gateName);

  if (failedGates.length > 0) {
    return {
      promotionAllowed: false,
      failedGates,
      instructions: `PROMOTION BLOCKED: The following quality gates failed: ${failedGates.join(', ')}. Please repair the issues in the sandbox clone and rerun the tests before promoting to production.`,
    };
  }

  // Safe Promotion: clean up test clone artifacts from production payload
  const cleanWorkflow = JSON.parse(JSON.stringify(workflowJson));

  let cleanName = cleanWorkflow.name || 'Workflow';
  if (cleanName.startsWith('[TEST]')) {
    cleanName = cleanName.replace(/^\[TEST\]\s*/, '');
  }
  cleanName = cleanName.replace(/_sandbox$/, '').replace(/_test$/, '');
  cleanWorkflow.name = cleanName;

  const sandboxTags = ['ai-generated', 'test', 'do-not-use-production'];
  if (Array.isArray(cleanWorkflow.tags)) {
    cleanWorkflow.tags = cleanWorkflow.tags.filter((t: string) => !sandboxTags.includes(t));
  }

  cleanWorkflow.active = true;

  const mode = productionWorkflowId ? 'update-by-id' : 'upsert-by-name';
  const recommendedMcpTool = productionWorkflowId ? 'n8n_update_full_workflow' : 'n8n_create_workflow';
  const recommendedMcpArguments: Record<string, any> = {
    name: cleanName,
    nodes: cleanWorkflow.nodes || [],
    connections: cleanWorkflow.connections || {},
    settings: cleanWorkflow.settings || {},
  };

  if (productionWorkflowId) {
    recommendedMcpArguments.id = productionWorkflowId;
    recommendedMcpArguments.intent = `Promote sandbox workflow ${testWorkflowId} to production workflow ${productionWorkflowId}`;
  }

  const requiredTools = productionWorkflowId
    ? ['n8n_update_full_workflow']
    : ['n8n_list_workflows', 'n8n_create_workflow', 'n8n_update_full_workflow'];

  const recommendedNextTool = productionWorkflowId
    ? 'n8n_update_full_workflow'
    : 'n8n_list_workflows';

  const sourceWorkflowHash = Buffer.from(JSON.stringify(workflowJson)).toString('base64').substring(0, 16);

  let instructions = '';
  if (productionWorkflowId) {
    instructions = `Promote to production by calling n8n_update_full_workflow on the production workflow ID "${productionWorkflowId}".`;
  } else {
    instructions = `Check if a production workflow named "${cleanName}" already exists using n8n_list_workflows({ name: "${cleanName}" }).\n` +
      `- If it exists, call n8n_update_full_workflow using its ID, name, and nodes/connections/settings from recommendedMcpArguments.\n` +
      `- If it does not exist, call n8n_create_workflow with the recommended arguments.`;
  }

  const haltInstruction = `\n\nCRITICAL: Before calling the recommended tool, check if the required n8n-mcp tools (${requiredTools.join(', ')}) are configured and available in your environment. If they are missing or if the backend cannot be reached, STOP immediately and ask the user to configure or connect their n8n-mcp server.`;
  instructions += haltInstruction;

  return {
    promotionAllowed: true,
    source: {
      testWorkflowId,
      sourceWorkflowHash,
    },
    target: {
      mode,
      productionWorkflowId,
    },
    sanitizedWorkflowJson: cleanWorkflow,
    recommendedMcpTool,
    recommendedMcpArguments,
    recommendedNextTool,
    requiredTools,
    instructions,
  };
}

export interface PrepareCleanupPlanArgs {
  sandboxWorkflowId: string;
}

export interface PrepareCleanupPlanResult {
  mode: 'delegated';
  recommendedMcpTool: string;
  recommendedMcpArguments: Record<string, any>;
  recommendedNextTool: string;
  requiredTools: string[];
  instructions: string;
}

export async function prepareCleanupPlan(args: PrepareCleanupPlanArgs): Promise<PrepareCleanupPlanResult> {
  const { sandboxWorkflowId } = args;
  if (!sandboxWorkflowId) {
    throw new Error('prepare_cleanup_plan requires sandboxWorkflowId.');
  }

  const recommendedMcpTool = 'n8n_delete_workflow';
  const recommendedMcpArguments = {
    id: sandboxWorkflowId,
  };

  const requiredTools = ['n8n_delete_workflow'];
  const recommendedNextTool = 'n8n_delete_workflow';

  const instructions = `Clean up sandbox test artifacts by calling n8n_delete_workflow with ID "${sandboxWorkflowId}".\n\n` +
    `CRITICAL: Before calling the recommended tool, check if the required n8n-mcp tools (${requiredTools.join(', ')}) are configured and available in your environment. If they are missing or if the backend cannot be reached, STOP immediately and ask the user to configure or connect their n8n-mcp server.`;

  return {
    mode: 'delegated',
    recommendedMcpTool,
    recommendedMcpArguments,
    recommendedNextTool,
    requiredTools,
    instructions,
  };
}
