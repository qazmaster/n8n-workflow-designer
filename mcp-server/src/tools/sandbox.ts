import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
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

function computeRootCauseId(failedNode: string, errorClass: string, message: string): string {
  const cleanMsg = message
    .replace(/[a-f0-9-]{36}/gi, 'ID_REDACTED')
    .replace(/[a-f0-9]{32}/gi, 'HASH_REDACTED')
    .replace(/\d+/g, 'N');
  const normalized = `${failedNode}:${errorClass}:${cleanMsg}`;
  return createHash('sha256').update(normalized).digest('hex').substring(0, 16);
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
  rootCauseId: string;
  repairAttemptId: string;
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

  const rootCauseId = computeRootCauseId(failedNode, errorClass, message);
  const repairAttemptId = uuidv4();

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
    rootCauseId,
    repairAttemptId,
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

  // 1. Remove top-level staticData
  delete cleanWorkflow.staticData;

  // 2. Identify test nodes to filter out, and delete pinData on the rest
  const testNodeNames = new Set<string>();
  const filteredNodes = [];

  const nodes = cleanWorkflow.nodes || [];
  for (const node of nodes) {
    const name = node.name || '';
    const nameLower = name.toLowerCase();
    if (name.startsWith('[TEST]') || nameLower.includes('mock') || nameLower.includes('test-only')) {
      testNodeNames.add(name);
    } else {
      const clonedNode = { ...node };
      delete clonedNode.pinData;
      filteredNodes.push(clonedNode);
    }
  }
  cleanWorkflow.nodes = filteredNodes;

  // 3. Purge connection links matching filtered out test nodes
  const connections = cleanWorkflow.connections || {};
  const newConnections: Record<string, any> = {};

  for (const source in connections) {
    if (testNodeNames.has(source)) continue;
    const srcConns = connections[source];
    const newSrcConns: Record<string, any> = {};
    for (const outputType in srcConns) {
      const branches = srcConns[outputType] || [];
      const newBranches = branches.map((branch: any) => {
        if (Array.isArray(branch)) {
          return branch.filter((target: any) => target && target.node && !testNodeNames.has(target.node));
        }
        return branch;
      });
      newSrcConns[outputType] = newBranches;
    }
    newConnections[source] = newSrcConns;
  }
  cleanWorkflow.connections = newConnections;

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

export interface EvaluateRepairScopeArgs {
  workflowJson: Record<string, any>;
  executionResult: any;
  failedAttempts: number;
  diagnosis?: any;
  rootCauseId?: string;
  repairAttemptId?: string;
}

export interface EvaluateRepairScopeResult {
  scope: 'patch' | 'refactor' | 'redesign';
  reason: string;
  failedAttempts: number;
  recommendedAction: 'patch' | 'refactor' | 'redesign';
  autoApplyAllowed: boolean;
  rootCauseId: string;
  repairAttemptId: string;
}

export async function evaluateRepairScope(args: EvaluateRepairScopeArgs): Promise<EvaluateRepairScopeResult> {
  const { workflowJson, executionResult, failedAttempts, diagnosis } = args;

  let failedNode = 'Unknown Node';
  let message = '';
  let errorClass = 'runtime_error';

  if (diagnosis && diagnosis.message) {
    message = diagnosis.message;
  } else if (executionResult) {
    const resultObj = typeof executionResult === 'string' ? JSON.parse(executionResult) : executionResult;
    const runData = resultObj?.data?.resultData?.runData || resultObj?.runData || {};
    for (const nodeName in runData) {
      const runs = runData[nodeName];
      if (Array.isArray(runs)) {
        for (const run of runs) {
          if (run.error) {
            failedNode = nodeName;
            message = run.error.message || '';
            errorClass = run.error.code || 'node_failure';
            break;
          }
        }
      }
    }
  }

  const computedRootCauseId = args.rootCauseId || computeRootCauseId(failedNode, errorClass, message);
  const computedRepairAttemptId = args.repairAttemptId || uuidv4();

  const lowerMsg = message.toLowerCase();

  if (failedAttempts >= 3) {
    return {
      scope: 'redesign',
      reason: `Repair loop exceeded maximum budget of 3 failed attempts on same root cause (${failedAttempts} attempts). Local patches are failing to resolve the issue.`,
      failedAttempts,
      recommendedAction: 'redesign',
      autoApplyAllowed: false,
      rootCauseId: computedRootCauseId,
      repairAttemptId: computedRepairAttemptId,
    };
  }

  // Redesign triggers: incorrect trigger, webhook/polling switch, split workflow, queue/retry, external API mismatch, credential requirements
  const redesignKeywords = ['trigger', 'webhook', 'polling', 'split', 'queue', 'rate limit', 'not supported', 'external api', 'credentials', 'dependency', 'auth'];
  // Refactor triggers: normalization layer, validation nodes, error handling branches, switch routing, subflows
  const refactorKeywords = ['normalization', 'validation', 'error branch', 'switch', 'subflow', 'nested', 'batches'];

  if (redesignKeywords.some(kw => lowerMsg.includes(kw))) {
    return {
      scope: 'redesign',
      reason: `Architectural mismatch detected: execution logs contain keywords suggesting trigger, credential, or external API limits mismatch that requires structural redesign.`,
      failedAttempts,
      recommendedAction: 'redesign',
      autoApplyAllowed: false,
      rootCauseId: computedRootCauseId,
      repairAttemptId: computedRepairAttemptId,
    };
  }

  if (refactorKeywords.some(kw => lowerMsg.includes(kw))) {
    return {
      scope: 'refactor',
      reason: `Structural refactoring recommended: execution logs indicate that data normalization, validation branches, subflows, or Switch nodes are needed.`,
      failedAttempts,
      recommendedAction: 'refactor',
      autoApplyAllowed: true,
      rootCauseId: computedRootCauseId,
      repairAttemptId: computedRepairAttemptId,
    };
  }

  return {
    scope: 'patch',
    reason: `Local patch is suitable: the issue appears to be a minor parameter or expression mismatch that can be safely updated in place.`,
    failedAttempts,
    recommendedAction: 'patch',
    autoApplyAllowed: true,
    rootCauseId: computedRootCauseId,
    repairAttemptId: computedRepairAttemptId,
  };
}

export interface PrepareRefactorPlanArgs {
  workflowJson: Record<string, any>;
  reason: string;
}

export interface PrepareRefactorPlanResult {
  mode: 'delegated';
  refactorRequired: boolean;
  reason: string;
  proposedChanges: string[];
  recommendedMcpTool: string;
  recommendedMcpArguments: Record<string, any>;
  instructions: string;
}

export async function prepareRefactorPlan(args: PrepareRefactorPlanArgs): Promise<PrepareRefactorPlanResult> {
  const { workflowJson, reason } = args;

  const proposedChanges = [
    `Insert validation or normalization Set/Code nodes before processing data in downstream integration nodes.`,
    `Ensure connection flows use native error handling or Switch nodes instead of monolithic JS blocks.`,
  ];

  const recommendedMcpTool = 'design_workflow';
  const recommendedMcpArguments = {
    description: `Refactor the workflow "${workflowJson.name || 'Current Workflow'}" to resolve the following issue: ${reason}. Preserve original business goals but improve robustness and data validation.`,
    idiomaticMode: true,
  };

  const instructions = `Refactor the sandbox workflow structure to resolve data shape/robustness issues:\n` +
    `1. Call design_workflow with the recommended description to generate the refactored code.\n` +
    `2. Compile, validate, and redeploy to the sandbox for testing.`;

  return {
    mode: 'delegated',
    refactorRequired: true,
    reason,
    proposedChanges,
    recommendedMcpTool,
    recommendedMcpArguments,
    instructions,
  };
}

export interface PrepareRedesignPlanArgs {
  workflowJson: Record<string, any>;
  reason: string;
  contract?: any;
}

export interface PrepareRedesignPlanResult {
  redesignRequired: boolean;
  reason: string;
  oldApproach: string;
  newApproach: string;
  newWorkflows: string[];
  migrationImpact: {
    breakingChange: boolean;
    requiresNewWebhookUrl: boolean;
    requiresTestCredentials: boolean;
    [key: string]: any;
  };
  requiresUserApproval: boolean;
  instructions: string;
}

export async function prepareRedesignPlan(args: PrepareRedesignPlanArgs): Promise<PrepareRedesignPlanResult> {
  const { workflowJson, reason } = args;

  const oldApproach = `Single linear workflow trigger: ${workflowJson.nodes?.find((n: any) => n.type.includes('trigger') || n.type.includes('webhook'))?.name || 'Trigger'}`;

  let newApproach = `Redesign workflow architecture. Split processing logic, transition from webhook to polling, or add queue/idempotency/retry patterns.`;
  let newWorkflows = [
    `${workflowJson.name || 'Workflow'} - Trigger Handler`,
    `${workflowJson.name || 'Workflow'} - Processing Queue / Subflow`,
  ];

  const lowerReason = reason.toLowerCase();
  if (lowerReason.includes('polling') || lowerReason.includes('webhook')) {
    newApproach = `Change trigger model from Webhook to Polling (or vice versa) to align with third-party API capabilities.`;
    newWorkflows = [`${workflowJson.name || 'Workflow'} (Polling Mode)`];
  } else if (lowerReason.includes('credentials') || lowerReason.includes('auth')) {
    newApproach = `Reconfigure authorization layers. Use service accounts instead of user-level OAuth, or secure credentials in n8n settings.`;
    newWorkflows = [`${workflowJson.name || 'Workflow'} (Authorized Variant)`];
  }

  return {
    redesignRequired: true,
    reason,
    oldApproach,
    newApproach,
    newWorkflows,
    migrationImpact: {
      breakingChange: true,
      requiresNewWebhookUrl: lowerReason.includes('webhook'),
      requiresTestCredentials: lowerReason.includes('credential') || lowerReason.includes('auth'),
    },
    requiresUserApproval: true,
    instructions: `REDESIGN REQUIRED: The workflow architecture must be updated because: "${reason}". Please present this proposal to the user, wait for confirmation, then run generate_workflow_variant to create a new sandbox variant.`,
  };
}

export interface GenerateWorkflowVariantArgs {
  workflowJson: Record<string, any>;
  variantName: string;
  modifications: {
    type: 'replace_node' | 'add_node' | 'split_workflow' | 'change_trigger';
    targetNode?: string;
    newNode?: Record<string, any>;
    [key: string]: any;
  }[];
}

export interface GenerateWorkflowVariantResult {
  variantWorkflowJson: Record<string, any>;
  success: boolean;
  message: string;
  subflowWorkflowJson?: Record<string, any>;
}

export async function generateWorkflowVariant(args: GenerateWorkflowVariantArgs): Promise<GenerateWorkflowVariantResult> {
  const { workflowJson, variantName, modifications } = args;
  if (!workflowJson) {
    throw new Error('generate_workflow_variant requires workflowJson.');
  }

  const variant = JSON.parse(JSON.stringify(workflowJson));
  variant.name = variantName;

  let nodes = variant.nodes || [];
  let subflowWorkflowJson: Record<string, any> | undefined;

  for (const mod of modifications) {
    if (mod.type === 'replace_node' && mod.targetNode && mod.newNode) {
      const idx = nodes.findIndex((n: any) => n.name === mod.targetNode);
      if (idx !== -1) {
        nodes[idx] = { ...nodes[idx], ...mod.newNode };
      }
    } else if (mod.type === 'add_node' && mod.newNode) {
      nodes.push(mod.newNode);
    } else if (mod.type === 'change_trigger' && mod.newNode) {
      const triggerIdx = nodes.findIndex((n: any) => n.type.toLowerCase().includes('trigger') || n.type.toLowerCase().includes('webhook'));
      if (triggerIdx !== -1) {
        nodes[triggerIdx] = { ...nodes[triggerIdx], ...mod.newNode };
      }
    } else if (mod.type === 'split_workflow' && mod.targetNode) {
      const targetNodeName = mod.targetNode;
      // 1. BFS to collect downstream nodes
      const downstream = new Set<string>();
      const queue = [targetNodeName];
      downstream.add(targetNodeName);

      const connections = variant.connections || {};

      while (queue.length > 0) {
        const current = queue.shift()!;
        const nodeConns = connections[current] || {};
        for (const outputType in nodeConns) {
          const branches = nodeConns[outputType] || [];
          for (const branch of branches) {
            if (Array.isArray(branch)) {
              for (const target of branch) {
                if (target && target.node && !downstream.has(target.node)) {
                  downstream.add(target.node);
                  queue.push(target.node);
                }
              }
            }
          }
        }
      }

      // 2. Separate nodes
      const subflowNodes = nodes.filter((n: any) => downstream.has(n.name));
      const remainingNodes = nodes.filter((n: any) => !downstream.has(n.name));

      // 3. New subflow node in main workflow
      const subflowNodeName = `Execute Subflow: ${targetNodeName}`;
      const subflowNode = {
        name: subflowNodeName,
        type: 'n8n-nodes-base.executeWorkflow',
        typeVersion: 1,
        position: nodes.find((n: any) => n.name === targetNodeName)?.position || [0, 0],
        parameters: {
          workflowId: mod.subflowWorkflowId || 'subflow-placeholder',
        }
      };
      remainingNodes.push(subflowNode);

      // 4. Update main connections
      const newConnections: Record<string, any> = {};
      for (const source in connections) {
        if (downstream.has(source)) continue;
        const srcConns = connections[source];
        const newSrcConns: Record<string, any> = {};
        for (const outputType in srcConns) {
          const branches = srcConns[outputType] || [];
          const newBranches = branches.map((branch: any) => {
            if (Array.isArray(branch)) {
              return branch.map((target: any) => {
                if (target && target.node === targetNodeName) {
                  return { ...target, node: subflowNodeName };
                }
                return target;
              });
            }
            return branch;
          });
          newSrcConns[outputType] = newBranches;
        }
        newConnections[source] = newSrcConns;
      }

      // 5. Build subflow connections
      const subflowConnections: Record<string, any> = {};
      for (const source of downstream) {
        if (connections[source]) {
          subflowConnections[source] = connections[source];
        }
      }

      // 6. Prepend Execute Workflow Trigger to subflow
      const triggerNodeName = 'Subflow Start';
      const subflowTriggerNode = {
        name: triggerNodeName,
        type: 'n8n-nodes-base.executeWorkflowTrigger',
        typeVersion: 1,
        position: [
          (subflowNodes[0]?.position?.[0] || 100) - 200,
          subflowNodes[0]?.position?.[1] || 100
        ]
      };
      subflowNodes.unshift(subflowTriggerNode);
      subflowConnections[triggerNodeName] = {
        main: [
          [
            {
              node: targetNodeName,
              type: 'main',
              index: 0
            }
          ]
        ]
      };

      variant.connections = newConnections;
      nodes = remainingNodes;

      subflowWorkflowJson = {
        name: `${variantName} - Subflow ${targetNodeName}`,
        nodes: subflowNodes,
        connections: subflowConnections,
        settings: variant.settings || {},
      };
    }
  }

  variant.nodes = nodes;

  return {
    variantWorkflowJson: variant,
    success: true,
    message: `Successfully generated workflow variant "${variantName}" with ${modifications.length} modifications.`,
    subflowWorkflowJson,
  };
}

export interface CompareWorkflowVariantsArgs {
  workflowJsonV1: Record<string, any>;
  workflowJsonV2: Record<string, any>;
}

export interface CompareWorkflowVariantsResult {
  differenceDetected: boolean;
  addedNodes: string[];
  removedNodes: string[];
  modifiedParameters: { node: string; path: string; v1: any; v2: any }[];
  comparisonSummary: string;
}

export async function compareWorkflowVariants(args: CompareWorkflowVariantsArgs): Promise<CompareWorkflowVariantsResult> {
  const { workflowJsonV1, workflowJsonV2 } = args;
  if (!workflowJsonV1 || !workflowJsonV2) {
    throw new Error('compare_workflow_variants requires both workflowJsonV1 and workflowJsonV2.');
  }

  const nodesV1 = workflowJsonV1.nodes || [];
  const nodesV2 = workflowJsonV2.nodes || [];

  const namesV1: string[] = nodesV1.map((n: any) => n.name || '');
  const namesV2: string[] = nodesV2.map((n: any) => n.name || '');

  const addedNodes = namesV2.filter((name: string) => !namesV1.includes(name));
  const removedNodes = namesV1.filter((name: string) => !namesV2.includes(name));

  const modifiedParameters: any[] = [];

  for (const node1 of nodesV1) {
    const node2 = nodesV2.find((n: any) => n.name === node1.name);
    if (node2) {
      const params1 = node1.parameters || {};
      const params2 = node2.parameters || {};
      for (const key in params1) {
        if (JSON.stringify(params1[key]) !== JSON.stringify(params2[key])) {
          modifiedParameters.push({
            node: node1.name,
            path: `parameters.${key}`,
            v1: params1[key],
            v2: params2[key],
          });
        }
      }
      for (const key in params2) {
        if (!(key in params1)) {
          modifiedParameters.push({
            node: node1.name,
            path: `parameters.${key}`,
            v1: undefined,
            v2: params2[key],
          });
        }
      }
    }
  }

  const differenceDetected = addedNodes.length > 0 || removedNodes.length > 0 || modifiedParameters.length > 0;

  let comparisonSummary = 'No changes detected between v1 and v2.';
  if (differenceDetected) {
    comparisonSummary = `Changes identified: added ${addedNodes.length} nodes, removed ${removedNodes.length} nodes, and modified ${modifiedParameters.length} parameters.`;
  }

  return {
    differenceDetected,
    addedNodes,
    removedNodes,
    modifiedParameters,
    comparisonSummary,
  };
}

export interface PrepareMigrationPlanArgs {
  productionWorkflowId?: string;
  workflowJsonV1: Record<string, any>;
  workflowJsonV2: Record<string, any>;
  rollbackSupported?: boolean;
}

export interface PrepareMigrationPlanResult {
  mode: 'delegated';
  breakingChanges: string[];
  deploymentSteps: string[];
  rollbackPlan: string[];
  recommendedMcpTool: string;
  recommendedMcpArguments: Record<string, any>;
  instructions: string;
}

export async function prepareMigrationPlan(args: PrepareMigrationPlanArgs): Promise<PrepareMigrationPlanResult> {
  const { productionWorkflowId, workflowJsonV1, workflowJsonV2, rollbackSupported = true } = args;

  const breakingChanges: string[] = [];
  const triggerV1 = workflowJsonV1.nodes?.find((n: any) => n.type.toLowerCase().includes('trigger') || n.type.toLowerCase().includes('webhook'));
  const triggerV2 = workflowJsonV2.nodes?.find((n: any) => n.type.toLowerCase().includes('trigger') || n.type.toLowerCase().includes('webhook'));

  if (triggerV1 && triggerV2 && triggerV1.type !== triggerV2.type) {
    breakingChanges.push(`Trigger type changed from ${triggerV1.type} to ${triggerV2.type}. This requires manual trigger reactivation or webhook URL updates in client systems.`);
  }

  const deploymentSteps = [
    `Deactivate current production workflow${productionWorkflowId ? ` (${productionWorkflowId})` : ''} to prevent concurrent runs.`,
    `Deploy the new redesigned variant "${workflowJsonV2.name || 'Redesigned Workflow'}" to production.`,
    `Verify external webhook URL registrations if the trigger type or webhook path was changed.`,
    `Activate the new production workflow.`,
  ];

  const rollbackPlan = [
    `If errors occur, deactivate the new production workflow.`,
    productionWorkflowId
      ? `Re-deploy the original v1 workflow using the backup JSON of "${workflowJsonV1.name || 'Original Workflow'}" to workflow ID ${productionWorkflowId}.`
      : `Re-deploy the original v1 workflow and restore the previous settings.`,
    `Re-activate the original workflow.`,
  ];

  const recommendedMcpTool = productionWorkflowId ? 'n8n_update_full_workflow' : 'n8n_create_workflow';
  const recommendedMcpArguments: Record<string, any> = {
    name: workflowJsonV2.name || 'Redesigned Workflow',
    nodes: workflowJsonV2.nodes || [],
    connections: workflowJsonV2.connections || {},
    settings: workflowJsonV2.settings || {},
  };
  if (productionWorkflowId) {
    recommendedMcpArguments.id = productionWorkflowId;
    recommendedMcpArguments.intent = `Migrate/overwrite production workflow ${productionWorkflowId} with redesigned variant`;
  }

  const instructions = `Execute the migration to deploy the redesigned workflow variant:\n` +
    `1. Deactivate current production workflow if active.\n` +
    `2. Call the recommended tool ${recommendedMcpTool} with the provided arguments to update/create the production workflow.\n` +
    `3. Reactivate the workflow and verify the integration.`;

  return {
    mode: 'delegated',
    breakingChanges,
    deploymentSteps,
    rollbackPlan,
    recommendedMcpTool,
    recommendedMcpArguments,
    instructions,
  };
}

