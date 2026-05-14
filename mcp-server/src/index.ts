import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { designWorkflow } from './tools/design.js';
import { compileWorkflow } from './tools/compile.js';
import { deployWorkflow } from './tools/deploy.js';
import { listWorkflows, getWorkflow } from './tools/list.js';
import { validateWorkflow } from './tools/validate.js';

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
        const result = await designWorkflow(args as any);
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
        const result = await compileWorkflow(args as any);
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
        const result = await deployWorkflow(args as any, N8N_BASE_URL, N8N_API_KEY);
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
        const result = await getWorkflow((args as any).workflowId, N8N_BASE_URL, N8N_API_KEY);
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
        const result = await validateWorkflow(args as any);
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
    throw new McpError(ErrorCode.InternalError, message);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('n8n Workflow MCP server running on stdio');
}

main().catch(console.error);
