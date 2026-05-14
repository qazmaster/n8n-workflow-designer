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
import { listWorkflows, getWorkflow } from './tools/list.js';
import { validateWorkflow, type ValidateWorkflowArgs } from './tools/validate.js';

const N8N_API_KEY = process.env.N8N_API_KEY || '';
const N8N_BASE_URL = process.env.N8N_BASE_URL || 'http://localhost:5678';

if (!N8N_API_KEY) {
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
          },
          required: ['workflowJson'],
        },
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
          },
          required: [],
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

      case 'list_workflows': {
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
