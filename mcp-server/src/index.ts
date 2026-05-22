import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { NodeJSON, WorkflowJSON } from '@n8n/workflow-sdk';
import { designWorkflow, type DesignWorkflowArgs } from './tools/design.js';
import { compileWorkflow, type CompileWorkflowArgs } from './tools/compile.js';
import { deployWorkflow, type DeployWorkflowArgs } from './tools/deploy.js';
import { executeWorkflow, type ExecuteWorkflowArgs } from './tools/execute.js';
import { listWorkflows, getWorkflow } from './tools/list.js';
import {
  exportWorkflow,
  importWorkflow,
  listCommunityPackages,
  listCredentials,
  type ExportWorkflowArgs,
  type ImportWorkflowArgs,
} from './tools/transfer.js';
import { validateWorkflow, type ValidateWorkflowArgs } from './tools/validate.js';
import {
  prepareDeployPlan,
  prepareExecutionPlan,
  prepareImportPlan,
  prepareExportPlan,
  type PrepareDeployPlanArgs,
  type PrepareExecutionPlanArgs,
  type PrepareImportPlanArgs,
  type PrepareExportPlanArgs,
} from './tools/prepare.js';
import {
  generateTestContract,
  validateWorkflowAgainstContract,
  type GenerateTestContractArgs,
  type ValidateWorkflowAgainstContractArgs,
} from './tools/test-contract.js';
import {
  prepareOfflineTestSuite,
  prepareIntegrationTestPlan,
  evaluateExecutionResult,
  type PrepareOfflineTestSuiteArgs,
  type PrepareIntegrationTestPlanArgs,
  type EvaluateExecutionResultArgs,
} from './tools/test-suite.js';
import {
  prepareSandboxDeployPlan,
  prepareExecutionSuite,
  prepareRepairPatch,
  preparePromotionPlan,
  prepareCleanupPlan,
  applyRepairPatch,
  prepareRetestPlan,
  type PrepareSandboxDeployPlanArgs,
  type PrepareExecutionSuiteArgs,
  type PrepareRepairPatchArgs,
  type PreparePromotionPlanArgs,
  type PrepareCleanupPlanArgs,
  type ApplyRepairPatchArgs,
  type PrepareRetestPlanArgs,
} from './tools/sandbox.js';

const DEPLOY_MODE = (process.env.N8N_DESIGNER_DEPLOY_MODE || 'standalone').toLowerCase();
const N8N_API_KEY = process.env.N8N_API_KEY || '';
const N8N_BASE_URL = process.env.N8N_BASE_URL || 'http://localhost:5678';

if (DEPLOY_MODE !== 'delegated' && !N8N_API_KEY) {
  console.error('Warning: N8N_API_KEY not set. Deployment tools will fail.');
}

const server = new Server(
  {
    name: 'n8n-workflow-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'design_workflow',
        description: 'Generate idiomatic n8n workflow TypeScript code from a natural language description. Prefers native nodes, credential references, Set transforms, AI Agent sub-nodes, error workflows, and supported community nodes.',
        inputSchema: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: 'Natural language description of the workflow (e.g., "When a new lead form is submitted, create a Bitrix24 deal and send a Teams notification")',
            },
            workflowId: {
              type: 'string',
              description: 'Unique workflow ID (optional, will generate if not provided)',
            },
            workflowName: {
              type: 'string',
              description: 'Human-readable workflow name (optional, will derive from description)',
            },
            includeErrorHandling: {
              type: 'boolean',
              description: 'Whether to include settings.errorWorkflow plus a companion error workflow (default: true)',
            },
            errorWorkflowId: {
              type: 'string',
              description: 'Existing error workflow ID to reference in settings.errorWorkflow (optional, generated if omitted)',
            },
            idiomaticMode: {
              type: 'boolean',
              description: 'Prefer idiomatic n8n patterns: native nodes over HTTP Request, credentials, Set nodes, AI Agent sub-nodes (default: true)',
            },
            enableCommunityNodes: {
              type: 'boolean',
              description: 'Allow community/optional nodes such as docxtemplater and Qdrant when requested (default: true)',
            },
            preferredNotificationChannel: {
              type: 'string',
              enum: ['telegram', 'teams', 'outlook'],
              description: 'Native notification node to use for generated alerts (default: telegram)',
            },
            outputFormat: {
              type: 'string',
              enum: ['decorator-typescript', 'sdk-json', 'both'],
              description: 'Return decorator TypeScript, @n8n/workflow-sdk-normalized JSON, or both (default: decorator-typescript)',
            },
          },
          required: ['description'],
        },
      },
      {
        name: 'compile_workflow',
        description: 'Compile TypeScript workflow code to n8n JSON format using @n8n-as-code/transformer.',
        inputSchema: {
          type: 'object',
          properties: {
            typescriptCode: {
              type: 'string',
              description: 'Complete TypeScript workflow code with @workflow, @node, @links decorators',
            },
            filePath: {
              type: 'string',
              description: 'Path to .workflow.ts file (alternative to typescriptCode)',
            },
          },
          required: [],
        },
      },
      {
        name: 'deploy_workflow',
        description: 'Deploy compiled n8n workflow JSON to a running n8n instance via REST API.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowJson: {
              type: 'object',
              description: 'Compiled n8n workflow JSON (from compile_workflow)',
            },
            activate: {
              type: 'boolean',
              description: 'Whether to activate the workflow after deployment (default: false)',
            },
            updateExisting: {
              type: 'boolean',
              description: 'Whether to update existing workflow by name instead of creating duplicate (default: true)',
            },
            workflowId: {
              type: 'string',
              description: 'Explicit n8n workflow ID to update. When provided, deploy uses update-by-ID semantics.',
            },
            mode: {
              type: 'string',
              enum: ['upsert-by-name', 'update-by-id', 'create'],
              description: 'Deployment strategy. Defaults to update by name unless updateExisting is false or workflowId is provided.',
            },
            dryRun: {
              type: 'boolean',
              description: 'Return sanitized deployment payload and strategy without calling create/update endpoints.',
            },
            confirmMutation: {
              type: 'boolean',
              description: 'Required to create, update, or activate workflows. Use dryRun first for non-mutating inspection.',
            },
          },
          required: ['workflowJson'],
        },
      },
      {
        name: 'execute_workflow',
        description: 'Manually execute a workflow through the n8n REST API and optionally poll execution status.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowId: { type: 'string', description: 'n8n workflow ID to execute.' },
            endpoint: { type: 'string', enum: ['execute', 'run'], description: 'Execution endpoint style. Use execute for current public API; run for compatible instances.' },
            workflowData: { type: 'object', description: 'Workflow data payload for run endpoint compatibility.' },
            startNodes: { type: 'array', items: { type: 'string' }, description: 'Optional node names to start execution from.' },
            destinationNode: { type: 'string', description: 'Optional destination node to execute up to.' },
            inputData: { description: 'Optional input data for manual execution.' },
            waitForCompletion: { type: 'boolean', description: 'Poll /executions/{id} until the execution finishes.' },
            pollIntervalMs: { type: 'number', description: 'Polling interval in milliseconds.' },
            timeoutMs: { type: 'number', description: 'Maximum polling duration in milliseconds.' },
            confirmMutation: { type: 'boolean', description: 'Required to execute workflows because execution can trigger external side effects.' },
          },
          required: ['workflowId'],
        },
      },
      {
        name: 'export_workflow',
        description: 'Fetch a workflow by ID and return portable JSON for review or re-import.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowId: { type: 'string', description: 'n8n workflow ID to export.' },
            includeMetadata: { type: 'boolean', description: 'Include instance metadata such as timestamps and sharing info.' },
          },
          required: ['workflowId'],
        },
      },
      {
        name: 'import_workflow',
        description: 'Import workflow JSON using the same safe create/update semantics as deploy_workflow.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowJson: { type: 'object', description: 'Workflow JSON to import.' },
            workflowId: { type: 'string', description: 'Explicit workflow ID for update-by-ID imports.' },
            mode: { type: 'string', enum: ['upsert-by-name', 'update-by-id', 'create'], description: 'Import strategy.' },
            activate: { type: 'boolean', description: 'Activate after import.' },
            dryRun: { type: 'boolean', description: 'Return the sanitized import plan without mutating n8n.' },
            confirmMutation: { type: 'boolean', description: 'Required to create, update, or activate workflows during import.' },
          },
          required: ['workflowJson'],
        },
      },
      {
        name: 'list_credentials',
        description: 'List credential metadata from n8n for resolving workflow credential placeholders. Secret data is not returned by n8n and is redacted defensively.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list_community_packages',
        description: 'List installed community packages from the target n8n instance.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list_workflows',
        description: 'List all workflows deployed on the n8n instance.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_workflow',
        description: 'Get detailed information about a specific workflow by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowId: {
              type: 'string',
              description: 'n8n workflow ID',
            },
          },
          required: ['workflowId'],
        },
      },
      {
        name: 'validate_workflow',
        description: 'Validate workflow structure and idiomatic n8n patterns. Warns on HTTP Request where native nodes exist, missing credentials, Code nodes used for simple transforms, incomplete AI Agent sub-node wiring, missing error workflow references, and community node requirements.',
        inputSchema: {
          type: 'object',
          properties: {
            typescriptCode: {
              type: 'string',
              description: 'TypeScript workflow code to validate',
            },
            workflowJson: {
              type: 'object',
              description: 'Compiled JSON to validate (alternative to typescriptCode)',
            },
            schemaValidation: {
              type: 'string',
              enum: ['off', 'known-node-registry'],
              description: 'Run local known-node registry checks for required parameters and supported community nodes. Defaults to known-node-registry.',
            },
          },
          required: [],
        },
      },
      {
        name: 'prepare_deploy_plan',
        description: 'Compile, sanitize, and validate a workflow (either from TypeScript code, file path, or JSON), producing a sanitized JSON payload, requiredTools list, and recommendedNextTool name for deployment via n8n-mcp.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowJson: {
              type: 'object',
              description: 'Optional raw or partial workflow JSON',
            },
            typescriptCode: {
              type: 'string',
              description: 'Optional TypeScript decorator code to compile',
            },
            filePath: {
              type: 'string',
              description: 'Optional absolute path to .workflow.ts file',
            },
            activate: {
              type: 'boolean',
              description: 'Whether to activate the workflow after deployment (default: false)',
            },
            updateExisting: {
              type: 'boolean',
              description: 'Whether to update existing workflow by name if no ID is provided (default: true)',
            },
            workflowId: {
              type: 'string',
              description: 'Explicit n8n workflow ID to update (forces update-by-id)',
            },
            mode: {
              type: 'string',
              enum: ['upsert-by-name', 'update-by-id', 'create'],
              description: 'Deployment strategy',
            },
          },
        },
      },
      {
        name: 'prepare_execution_plan',
        description: 'Prepare recommended arguments, requiredTools list, and recommendedNextTool name for triggering workflow execution via n8n-mcp.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowId: {
              type: 'string',
              description: 'n8n workflow ID to execute',
            },
            endpoint: {
              type: 'string',
              enum: ['execute', 'run'],
              description: 'Execution style (default: execute)',
            },
            inputData: {
              type: 'object',
              description: 'Optional execution input data',
            },
            triggerType: {
              type: 'string',
              description: 'Optional trigger type (webhook/form/chat)',
            },
            message: {
              type: 'string',
              description: 'Optional chat trigger message',
            },
          },
          required: ['workflowId'],
        },
      },
      {
        name: 'prepare_import_plan',
        description: 'Prepare a clean workflow import payload, requiredTools list, and recommendedNextTool name for importing via n8n-mcp.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowJson: {
              type: 'object',
              description: 'Complete workflow JSON to import',
            },
            workflowId: {
              type: 'string',
              description: 'Explicit workflow ID for update-by-ID imports',
            },
            mode: {
              type: 'string',
              enum: ['upsert-by-name', 'update-by-id', 'create'],
              description: 'Import strategy',
            },
            activate: {
              type: 'boolean',
              description: 'Activate after import (default: false)',
            },
          },
          required: ['workflowJson'],
        },
      },
      {
        name: 'prepare_export_plan',
        description: 'Prepare details, requiredTools list, and recommendedNextTool name to fetch portable JSON via n8n-mcp.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowId: {
              type: 'string',
              description: 'n8n workflow ID to export',
            },
            includeMetadata: {
              type: 'boolean',
              description: 'Whether to include instance metadata (default: false)',
            },
          },
          required: ['workflowId'],
        },
      },
      {
        name: 'generate_test_contract',
        description: 'Generate a declarative test contract (JSON) from a user prompt and optional workflow specifications.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Natural language description of the test scenario',
            },
            workflowSpec: {
              type: 'string',
              description: 'Optional workflow spec or description to scan for node names',
            },
          },
          required: ['prompt'],
        },
      },
      {
        name: 'validate_workflow_against_contract',
        description: 'Perform static path and policy checks on a workflow JSON against a declarative test contract.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowJson: {
              type: 'object',
              description: 'Compiled workflow JSON',
            },
            contract: {
              type: 'object',
              description: 'Test contract JSON containing test cases and forbidden rules',
            },
          },
          required: ['workflowJson', 'contract'],
        },
      },
      {
        name: 'prepare_offline_test_suite',
        description: 'Generate a local TypeScript Vitest test file to perform offline validation of the workflow.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowPath: {
              type: 'string',
              description: 'Absolute path to compiled workflow JSON or TypeScript code',
            },
            testPath: {
              type: 'string',
              description: 'Absolute path to output test file',
            },
          },
          required: ['workflowPath', 'testPath'],
        },
      },
      {
        name: 'prepare_integration_test_plan',
        description: 'Create an integration test plan overlay containing mock pinData and expected output assertions.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowJson: {
              type: 'object',
              description: 'Compiled workflow JSON',
            },
            contract: {
              type: 'object',
              description: 'Test contract JSON containing test cases and expected outputs',
            },
          },
          required: ['workflowJson', 'contract'],
        },
      },
      {
        name: 'evaluate_execution_result',
        description: 'Evaluate execution output or execution logs retrieved from n8n-mcp against test assertions.',
        inputSchema: {
          type: 'object',
          properties: {
            executionResult: {
              type: 'object',
              description: 'Execution result object retrieved from n8n-mcp n8n_test_workflow or n8n_executions',
            },
            assertions: {
              type: 'array',
              description: 'List of expected assertions',
            },
          },
          required: ['executionResult', 'assertions'],
        },
      },
      {
        name: 'prepare_sandbox_deploy_plan',
        description: 'Prepare a sandbox deployment plan clone with test tags, inactive status, and a prefixed/suffixed name.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowJson: {
              type: 'object',
              description: 'Compiled workflow JSON',
            },
            typescriptCode: {
              type: 'string',
              description: 'TypeScript workflow code',
            },
            filePath: {
              type: 'string',
              description: 'Path to .workflow.ts file',
            },
            sandboxWorkflowId: {
              type: 'string',
              description: 'Existing sandbox workflow ID to update (optional)',
            },
            sandboxSuffix: {
              type: 'string',
              description: 'Suffix to append to name (default: _sandbox)',
            },
          },
        },
      },
      {
        name: 'prepare_execution_suite',
        description: 'Generate execution plan suite matching all contract test cases to run on the sandbox clone.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowId: {
              type: 'string',
              description: 'Sandbox workflow ID',
            },
            contract: {
              type: 'object',
              description: 'Test contract JSON containing test cases',
            },
          },
          required: ['workflowId', 'contract'],
        },
      },
      {
        name: 'prepare_repair_patch',
        description: 'Analyze sandbox manual execution results, diagnosing bugs and recommending expression/parameter patches.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowJson: {
              type: 'object',
              description: 'Original or current workflow JSON',
            },
            executionResult: {
              type: 'object',
              description: 'Execution result object retrieved from n8n',
            },
            failedNodeName: {
              type: 'string',
              description: 'Name of the node that failed (optional)',
            },
            errorMessage: {
              type: 'string',
              description: 'Error message (optional)',
            },
          },
          required: ['workflowJson', 'executionResult'],
        },
      },
      {
        name: 'prepare_promotion_plan',
        description: 'Evaluate quality gates and promote a validated test clone workflow to a production workflow.',
        inputSchema: {
          type: 'object',
          properties: {
            testWorkflowId: {
              type: 'string',
              description: 'Sandbox test clone workflow ID',
            },
            productionWorkflowId: {
              type: 'string',
              description: 'Production workflow ID to update (optional)',
            },
            workflowJson: {
              type: 'object',
              description: 'Workflow JSON to promote',
            },
            gates: {
              type: 'object',
              properties: {
                staticValidation: { type: 'string', enum: ['passed', 'failed'] },
                sandboxExecutions: { type: 'string', enum: ['passed', 'failed'] },
                credentialPolicy: { type: 'string', enum: ['passed', 'failed'] },
                noTestArtifacts: { type: 'string', enum: ['passed', 'failed'] },
              },
              required: ['staticValidation', 'sandboxExecutions', 'credentialPolicy', 'noTestArtifacts'],
            },
          },
          required: ['testWorkflowId', 'workflowJson', 'gates'],
        },
      },
      {
        name: 'prepare_cleanup_plan',
        description: 'Prepare a cleanup plan to delete the sandbox test clone workflow.',
        inputSchema: {
          type: 'object',
          properties: {
            sandboxWorkflowId: {
              type: 'string',
              description: 'Sandbox workflow ID to delete',
            },
          },
          required: ['sandboxWorkflowId'],
        },
      },
      {
        name: 'apply_repair_patch',
        description: 'Apply a recommended node parameter patch to the workflow JSON.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowJson: {
              type: 'object',
              description: 'Workflow JSON to patch',
            },
            patch: {
              type: 'object',
              properties: {
                node: { type: 'string', description: 'Name of the node to patch' },
                path: { type: 'string', description: 'Path to node parameter to modify' },
                to: { description: 'New value to set' },
              },
              required: ['node', 'path', 'to'],
            },
          },
          required: ['workflowJson', 'patch'],
        },
      },
      {
        name: 'prepare_retest_plan',
        description: 'Prepare a plan to deploy the patched workflow and rerun sandbox executions.',
        inputSchema: {
          type: 'object',
          properties: {
            sandboxWorkflowId: {
              type: 'string',
              description: 'Sandbox workflow ID',
            },
            workflowJson: {
              type: 'object',
              description: 'Patched workflow JSON',
            },
          },
          required: ['sandboxWorkflowId', 'workflowJson'],
        },
      },
    ],
  };
});


server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'design_workflow': {
        const result = await designWorkflow(parseDesignWorkflowArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        };
      }

      case 'compile_workflow': {
        const result = await compileWorkflow(parseCompileWorkflowArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'deploy_workflow': {
        if (DEPLOY_MODE === 'delegated') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Direct tool calling is disabled because the server is running in DELEGATED mode.',
                  recommendedTool: 'prepare_deploy_plan',
                  hint: 'Please run prepare_deploy_plan first, then execute mutations using czlonkowski/n8n-mcp.',
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
        const result = await deployWorkflow(parseDeployWorkflowArgs(args), N8N_BASE_URL, N8N_API_KEY);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'execute_workflow': {
        if (DEPLOY_MODE === 'delegated') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Direct tool calling is disabled because the server is running in DELEGATED mode.',
                  recommendedTool: 'prepare_execution_plan',
                  hint: 'Please run prepare_execution_plan first, then execute mutations using czlonkowski/n8n-mcp.',
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
        const result = await executeWorkflow(parseExecuteWorkflowArgs(args), N8N_BASE_URL, N8N_API_KEY);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'export_workflow': {
        if (DEPLOY_MODE === 'delegated') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Direct tool calling is disabled because the server is disabled or running in DELEGATED mode.',
                  recommendedTool: 'prepare_export_plan',
                  hint: 'Please run prepare_export_plan first, then execute mutations using czlonkowski/n8n-mcp.',
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
        const result = await exportWorkflow(parseExportWorkflowArgs(args), N8N_BASE_URL, N8N_API_KEY);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'import_workflow': {
        if (DEPLOY_MODE === 'delegated') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Direct tool calling is disabled because the server is running in DELEGATED mode.',
                  recommendedTool: 'prepare_import_plan',
                  hint: 'Please run prepare_import_plan first, then execute mutations using czlonkowski/n8n-mcp.',
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
        const result = await importWorkflow(parseImportWorkflowArgs(args), N8N_BASE_URL, N8N_API_KEY);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'list_credentials': {
        if (DEPLOY_MODE === 'delegated') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'This tool requires a direct connection to the n8n API. It is disabled in DELEGATED mode.',
                  hint: 'Run the server in standalone mode by setting N8N_DESIGNER_DEPLOY_MODE=standalone, or use the corresponding tools in czlonkowski/n8n-mcp.',
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
        const result = await listCredentials(N8N_BASE_URL, N8N_API_KEY);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'list_community_packages': {
        if (DEPLOY_MODE === 'delegated') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'This tool requires a direct connection to the n8n API. It is disabled in DELEGATED mode.',
                  hint: 'Run the server in standalone mode by setting N8N_DESIGNER_DEPLOY_MODE=standalone, or use the corresponding tools in czlonkowski/n8n-mcp.',
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
        const result = await listCommunityPackages(N8N_BASE_URL, N8N_API_KEY);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'list_workflows': {
        if (DEPLOY_MODE === 'delegated') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'This tool requires a direct connection to the n8n API. It is disabled in DELEGATED mode.',
                  hint: 'Run the server in standalone mode by setting N8N_DESIGNER_DEPLOY_MODE=standalone, or use the corresponding tools in czlonkowski/n8n-mcp.',
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
        const result = await listWorkflows(N8N_BASE_URL, N8N_API_KEY);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_workflow': {
        if (DEPLOY_MODE === 'delegated') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'This tool requires a direct connection to the n8n API. It is disabled in DELEGATED mode.',
                  hint: 'Run the server in standalone mode by setting N8N_DESIGNER_DEPLOY_MODE=standalone, or use the corresponding tools in czlonkowski/n8n-mcp.',
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
        const result = await getWorkflow(parseGetWorkflowArgs(args).workflowId, N8N_BASE_URL, N8N_API_KEY);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'prepare_deploy_plan': {
        const result = await prepareDeployPlan(parsePrepareDeployPlanArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'prepare_execution_plan': {
        const result = await prepareExecutionPlan(parsePrepareExecutionPlanArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'prepare_import_plan': {
        const result = await prepareImportPlan(parsePrepareImportPlanArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'prepare_export_plan': {
        const result = await prepareExportPlan(parsePrepareExportPlanArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'validate_workflow': {
        const result = await validateWorkflow(parseValidateWorkflowArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'generate_test_contract': {
        const result = await generateTestContract(parseGenerateTestContractArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'validate_workflow_against_contract': {
        const result = await validateWorkflowAgainstContract(parseValidateWorkflowAgainstContractArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'prepare_offline_test_suite': {
        const result = await prepareOfflineTestSuite(parsePrepareOfflineTestSuiteArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'prepare_integration_test_plan': {
        const result = await prepareIntegrationTestPlan(parsePrepareIntegrationTestPlanArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'evaluate_execution_result': {
        const result = await evaluateExecutionResult(parseEvaluateExecutionResultArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'prepare_sandbox_deploy_plan': {
        const result = await prepareSandboxDeployPlan(parsePrepareSandboxDeployPlanArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'prepare_execution_suite': {
        const result = await prepareExecutionSuite(parsePrepareExecutionSuiteArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'prepare_repair_patch': {
        const result = await prepareRepairPatch(parsePrepareRepairPatchArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'prepare_promotion_plan': {
        const result = await preparePromotionPlan(parsePreparePromotionPlanArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'prepare_cleanup_plan': {
        const result = await prepareCleanupPlan(parsePrepareCleanupPlanArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'apply_repair_patch': {
        const result = await applyRepairPatch(parseApplyRepairPatchArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'prepare_retest_plan': {
        const result = await prepareRetestPlan(parsePrepareRetestPlanArgs(args));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }


      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new McpError(error instanceof ArgumentError ? ErrorCode.InvalidParams : ErrorCode.InternalError, message);
  }
});

class ArgumentError extends Error {}

function parseDesignWorkflowArgs(args: unknown): DesignWorkflowArgs {
  const input = objectArgs(args);
  const description = requiredString(input.description, 'description');
  return {
    description,
    workflowId: optionalString(input.workflowId, 'workflowId'),
    workflowName: optionalString(input.workflowName, 'workflowName'),
    includeErrorHandling: optionalBoolean(input.includeErrorHandling, 'includeErrorHandling'),
    errorWorkflowId: optionalString(input.errorWorkflowId, 'errorWorkflowId'),
    idiomaticMode: optionalBoolean(input.idiomaticMode, 'idiomaticMode'),
    enableCommunityNodes: optionalBoolean(input.enableCommunityNodes, 'enableCommunityNodes'),
    preferredNotificationChannel: optionalEnum(input.preferredNotificationChannel, ['telegram', 'teams', 'outlook'], 'preferredNotificationChannel'),
    outputFormat: optionalEnum(input.outputFormat, ['decorator-typescript', 'sdk-json', 'both'], 'outputFormat'),
  };
}

function parseCompileWorkflowArgs(args: unknown): CompileWorkflowArgs {
  const input = objectArgs(args);
  return {
    typescriptCode: optionalString(input.typescriptCode, 'typescriptCode'),
    filePath: optionalString(input.filePath, 'filePath'),
  };
}

function parseDeployWorkflowArgs(args: unknown): DeployWorkflowArgs {
  const input = objectArgs(args);
  const workflowJson = input.workflowJson;
  assertWorkflowJsonShape(workflowJson, 'workflowJson');
  return {
    workflowJson,
    activate: optionalBoolean(input.activate, 'activate'),
    updateExisting: optionalBoolean(input.updateExisting, 'updateExisting'),
    workflowId: optionalString(input.workflowId, 'workflowId'),
    mode: optionalEnum(input.mode, ['upsert-by-name', 'update-by-id', 'create'], 'mode'),
    dryRun: optionalBoolean(input.dryRun, 'dryRun'),
    confirmMutation: optionalBoolean(input.confirmMutation, 'confirmMutation'),
  };
}

function parseExecuteWorkflowArgs(args: unknown): ExecuteWorkflowArgs {
  const input = objectArgs(args);
  return {
    workflowId: requiredString(input.workflowId, 'workflowId'),
    workflowData: optionalRecord(input.workflowData, 'workflowData'),
    startNodes: optionalStringArray(input.startNodes, 'startNodes'),
    destinationNode: optionalString(input.destinationNode, 'destinationNode'),
    inputData: input.inputData,
    endpoint: optionalEnum(input.endpoint, ['execute', 'run'], 'endpoint'),
    waitForCompletion: optionalBoolean(input.waitForCompletion, 'waitForCompletion'),
    pollIntervalMs: optionalNumber(input.pollIntervalMs, 'pollIntervalMs'),
    timeoutMs: optionalNumber(input.timeoutMs, 'timeoutMs'),
    confirmMutation: optionalBoolean(input.confirmMutation, 'confirmMutation'),
  };
}

function parseExportWorkflowArgs(args: unknown): ExportWorkflowArgs {
  const input = objectArgs(args);
  return {
    workflowId: requiredString(input.workflowId, 'workflowId'),
    includeMetadata: optionalBoolean(input.includeMetadata, 'includeMetadata'),
  };
}

function parseImportWorkflowArgs(args: unknown): ImportWorkflowArgs {
  const input = objectArgs(args);
  const workflowJson = input.workflowJson;
  assertWorkflowJsonShape(workflowJson, 'workflowJson');
  return {
    workflowJson,
    workflowId: optionalString(input.workflowId, 'workflowId'),
    mode: optionalEnum(input.mode, ['upsert-by-name', 'update-by-id', 'create'], 'mode'),
    activate: optionalBoolean(input.activate, 'activate'),
    dryRun: optionalBoolean(input.dryRun, 'dryRun'),
    confirmMutation: optionalBoolean(input.confirmMutation, 'confirmMutation'),
  };
}

function parseGetWorkflowArgs(args: unknown): { workflowId: string } {
  const input = objectArgs(args);
  return { workflowId: requiredString(input.workflowId, 'workflowId') };
}

function parseValidateWorkflowArgs(args: unknown): ValidateWorkflowArgs {
  const input = objectArgs(args);
  const workflowJson = input.workflowJson;
  if (workflowJson !== undefined) {
    assertWorkflowJsonShape(workflowJson, 'workflowJson');
  }
  return {
    typescriptCode: optionalString(input.typescriptCode, 'typescriptCode'),
    workflowJson,
    schemaValidation: optionalEnum(input.schemaValidation, ['off', 'known-node-registry'], 'schemaValidation'),
  };
}

function parsePrepareDeployPlanArgs(args: unknown): PrepareDeployPlanArgs {
  const input = objectArgs(args);
  const workflowJson = input.workflowJson;
  if (workflowJson !== undefined) {
    assertWorkflowJsonShape(workflowJson, 'workflowJson');
  }
  return {
    workflowJson,
    typescriptCode: optionalString(input.typescriptCode, 'typescriptCode'),
    filePath: optionalString(input.filePath, 'filePath'),
    activate: optionalBoolean(input.activate, 'activate'),
    updateExisting: optionalBoolean(input.updateExisting, 'updateExisting'),
    workflowId: optionalString(input.workflowId, 'workflowId'),
    mode: optionalEnum(input.mode, ['upsert-by-name', 'update-by-id', 'create'], 'mode'),
  };
}

function parsePrepareExecutionPlanArgs(args: unknown): PrepareExecutionPlanArgs {
  const input = objectArgs(args);
  return {
    workflowId: requiredString(input.workflowId, 'workflowId'),
    endpoint: optionalEnum(input.endpoint, ['execute', 'run'], 'endpoint'),
    inputData: input.inputData,
    triggerType: optionalString(input.triggerType, 'triggerType'),
    message: optionalString(input.message, 'message'),
  };
}

function parsePrepareImportPlanArgs(args: unknown): PrepareImportPlanArgs {
  const input = objectArgs(args);
  const workflowJson = input.workflowJson;
  assertWorkflowJsonShape(workflowJson, 'workflowJson');
  return {
    workflowJson,
    workflowId: optionalString(input.workflowId, 'workflowId'),
    mode: optionalEnum(input.mode, ['upsert-by-name', 'update-by-id', 'create'], 'mode'),
    activate: optionalBoolean(input.activate, 'activate'),
  };
}

function parsePrepareExportPlanArgs(args: unknown): PrepareExportPlanArgs {
  const input = objectArgs(args);
  return {
    workflowId: requiredString(input.workflowId, 'workflowId'),
    includeMetadata: optionalBoolean(input.includeMetadata, 'includeMetadata'),
  };
}

function parseGenerateTestContractArgs(args: unknown): GenerateTestContractArgs {
  const input = objectArgs(args);
  return {
    prompt: requiredString(input.prompt, 'prompt'),
    workflowSpec: optionalString(input.workflowSpec, 'workflowSpec'),
  };
}

function parseValidateWorkflowAgainstContractArgs(args: unknown): ValidateWorkflowAgainstContractArgs {
  const input = objectArgs(args);
  const workflowJson = input.workflowJson;
  assertWorkflowJsonShape(workflowJson, 'workflowJson');
  
  const contract = input.contract;
  if (!isObjectRecord(contract)) {
    throw new ArgumentError('contract must be an object.');
  }
  if (typeof contract.workflowName !== 'string') {
    throw new ArgumentError('contract.workflowName must be a string.');
  }
  if (!Array.isArray(contract.testCases)) {
    throw new ArgumentError('contract.testCases must be an array.');
  }

  return {
    workflowJson: workflowJson as any,
    contract: contract as any,
  };
}

function parsePrepareOfflineTestSuiteArgs(args: unknown): PrepareOfflineTestSuiteArgs {
  const input = objectArgs(args);
  return {
    workflowPath: requiredString(input.workflowPath, 'workflowPath'),
    testPath: requiredString(input.testPath, 'testPath'),
  };
}

function parsePrepareIntegrationTestPlanArgs(args: unknown): PrepareIntegrationTestPlanArgs {
  const input = objectArgs(args);
  const workflowJson = input.workflowJson;
  assertWorkflowJsonShape(workflowJson, 'workflowJson');

  const contract = input.contract;
  if (!isObjectRecord(contract)) {
    throw new ArgumentError('contract must be an object.');
  }
  if (typeof contract.workflowName !== 'string') {
    throw new ArgumentError('contract.workflowName must be a string.');
  }
  if (!Array.isArray(contract.testCases)) {
    throw new ArgumentError('contract.testCases must be an array.');
  }

  return {
    workflowJson: workflowJson as any,
    contract: contract as any,
  };
}

function parseEvaluateExecutionResultArgs(args: unknown): EvaluateExecutionResultArgs {
  const input = objectArgs(args);
  const executionResult = input.executionResult;
  if (!isObjectRecord(executionResult)) {
    throw new ArgumentError('executionResult must be an object.');
  }

  const assertions = input.assertions;
  if (!Array.isArray(assertions)) {
    throw new ArgumentError('assertions must be an array.');
  }

  return {
    executionResult,
    assertions,
  };
}

function parsePrepareSandboxDeployPlanArgs(args: unknown): PrepareSandboxDeployPlanArgs {
  const input = objectArgs(args);
  const workflowJson = input.workflowJson;
  if (workflowJson !== undefined) {
    assertWorkflowJsonShape(workflowJson, 'workflowJson');
  }
  return {
    workflowJson,
    typescriptCode: optionalString(input.typescriptCode, 'typescriptCode'),
    filePath: optionalString(input.filePath, 'filePath'),
    sandboxWorkflowId: optionalString(input.sandboxWorkflowId, 'sandboxWorkflowId'),
    sandboxSuffix: optionalString(input.sandboxSuffix, 'sandboxSuffix'),
  };
}

function parsePrepareExecutionSuiteArgs(args: unknown): PrepareExecutionSuiteArgs {
  const input = objectArgs(args);
  const contract = input.contract;
  if (!isObjectRecord(contract)) {
    throw new ArgumentError('contract must be an object.');
  }
  if (typeof contract.workflowName !== 'string') {
    throw new ArgumentError('contract.workflowName must be a string.');
  }
  if (!Array.isArray(contract.testCases)) {
    throw new ArgumentError('contract.testCases must be an array.');
  }

  return {
    workflowId: requiredString(input.workflowId, 'workflowId'),
    contract: contract as any,
  };
}

function parsePrepareRepairPatchArgs(args: unknown): PrepareRepairPatchArgs {
  const input = objectArgs(args);
  const workflowJson = input.workflowJson;
  assertWorkflowJsonShape(workflowJson, 'workflowJson');

  const executionResult = input.executionResult;
  if (!isObjectRecord(executionResult)) {
    throw new ArgumentError('executionResult must be an object.');
  }

  return {
    workflowJson: workflowJson as any,
    executionResult,
    failedNodeName: optionalString(input.failedNodeName, 'failedNodeName'),
    errorMessage: optionalString(input.errorMessage, 'errorMessage'),
  };
}

function parsePreparePromotionPlanArgs(args: unknown): PreparePromotionPlanArgs {
  const input = objectArgs(args);
  const workflowJson = input.workflowJson;
  assertWorkflowJsonShape(workflowJson, 'workflowJson');

  const gates = input.gates;
  if (!isObjectRecord(gates)) {
    throw new ArgumentError('gates must be an object.');
  }

  const allowedStatuses = ['passed', 'failed'];
  for (const gateName of ['staticValidation', 'sandboxExecutions', 'credentialPolicy', 'noTestArtifacts']) {
    const status = gates[gateName];
    if (typeof status !== 'string' || !allowedStatuses.includes(status)) {
      throw new ArgumentError(`gates.${gateName} must be either 'passed' or 'failed'.`);
    }
  }

  return {
    testWorkflowId: requiredString(input.testWorkflowId, 'testWorkflowId'),
    productionWorkflowId: optionalString(input.productionWorkflowId, 'productionWorkflowId'),
    workflowJson: workflowJson as any,
    gates: gates as any,
  };
}

function parsePrepareCleanupPlanArgs(args: unknown): PrepareCleanupPlanArgs {
  const input = objectArgs(args);
  return {
    sandboxWorkflowId: requiredString(input.sandboxWorkflowId, 'sandboxWorkflowId'),
  };
}

function parseApplyRepairPatchArgs(args: unknown): ApplyRepairPatchArgs {
  const input = objectArgs(args);
  const workflowJson = input.workflowJson;
  assertWorkflowJsonShape(workflowJson, 'workflowJson');

  const patch = input.patch;
  if (!isObjectRecord(patch)) {
    throw new ArgumentError('patch must be an object.');
  }

  return {
    workflowJson: workflowJson as any,
    patch: {
      node: requiredString(patch.node, 'patch.node'),
      path: requiredString(patch.path, 'patch.path'),
      to: patch.to,
    },
  };
}

function parsePrepareRetestPlanArgs(args: unknown): PrepareRetestPlanArgs {
  const input = objectArgs(args);
  const workflowJson = input.workflowJson;
  assertWorkflowJsonShape(workflowJson, 'workflowJson');

  return {
    sandboxWorkflowId: requiredString(input.sandboxWorkflowId, 'sandboxWorkflowId'),
    workflowJson: workflowJson as any,
  };
}


function objectArgs(args: unknown): Record<string, unknown> {
  if (args === undefined || args === null) {
    return {};
  }
  if (!isObjectRecord(args)) {
    throw new ArgumentError('Tool arguments must be an object.');
  }
  return args;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ArgumentError(`${fieldName} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ArgumentError(`${fieldName} must be a string when provided.`);
  }
  return value;
}

function optionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new ArgumentError(`${fieldName} must be a boolean when provided.`);
  }
  return value;
}

function optionalNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ArgumentError(`${fieldName} must be a finite number when provided.`);
  }
  return value;
}

function optionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ArgumentError(`${fieldName} must be an array of strings when provided.`);
  }
  return value;
}

function optionalRecord(value: unknown, fieldName: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isObjectRecord(value)) {
    throw new ArgumentError(`${fieldName} must be an object when provided.`);
  }
  return value;
}

function optionalEnum<const T extends readonly string[]>(value: unknown, allowed: T, fieldName: string): T[number] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ArgumentError(`${fieldName} must be one of: ${allowed.join(', ')}.`);
  }
  return value;
}

function assertWorkflowJsonShape(value: unknown, fieldName: string): asserts value is Partial<WorkflowJSON> & { nodes?: Array<Partial<NodeJSON>> } {
  if (!isObjectRecord(value)) {
    throw new ArgumentError(`${fieldName} must be an object.`);
  }
  if ('name' in value && typeof value.name !== 'string') {
    throw new ArgumentError(`${fieldName}.name must be a string when provided.`);
  }
  if ('nodes' in value) {
    if (!Array.isArray(value.nodes)) {
      throw new ArgumentError(`${fieldName}.nodes must be an array when provided.`);
    }
    for (const [index, node] of value.nodes.entries()) {
      assertWorkflowNodeShape(node, `${fieldName}.nodes[${index}]`);
    }
  }
  if ('connections' in value && !isObjectRecord(value.connections)) {
    throw new ArgumentError(`${fieldName}.connections must be an object when provided.`);
  }
  if ('settings' in value && !isObjectRecord(value.settings)) {
    throw new ArgumentError(`${fieldName}.settings must be an object when provided.`);
  }
}

function assertWorkflowNodeShape(value: unknown, fieldName: string): asserts value is Partial<NodeJSON> {
  if (!isObjectRecord(value)) {
    throw new ArgumentError(`${fieldName} must be an object.`);
  }
  for (const key of ['id', 'name', 'type'] as const) {
    if (key in value && typeof value[key] !== 'string') {
      throw new ArgumentError(`${fieldName}.${key} must be a string when provided.`);
    }
  }
  if ('typeVersion' in value && typeof value.typeVersion !== 'number') {
    throw new ArgumentError(`${fieldName}.typeVersion must be a number when provided.`);
  }
  if ('position' in value && !isPositionTuple(value.position)) {
    throw new ArgumentError(`${fieldName}.position must be a [number, number] tuple when provided.`);
  }
  if ('parameters' in value && !isObjectRecord(value.parameters)) {
    throw new ArgumentError(`${fieldName}.parameters must be an object when provided.`);
  }
  if ('credentials' in value && !isObjectRecord(value.credentials)) {
    throw new ArgumentError(`${fieldName}.credentials must be an object when provided.`);
  }
}

function isPositionTuple(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'number');
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('n8n Workflow MCP server running on stdio');
}

main().catch(console.error);
