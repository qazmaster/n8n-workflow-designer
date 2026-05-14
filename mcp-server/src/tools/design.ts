import { v4 as uuidv4 } from 'uuid';
import { workflow as sdkWorkflow, type NodeJSON, type WorkflowJSON } from '@n8n/workflow-sdk';

export interface DesignWorkflowArgs {
  description: string;
  workflowId?: string;
  workflowName?: string;
  includeErrorHandling?: boolean;
  errorWorkflowId?: string;
  idiomaticMode?: boolean;
  enableCommunityNodes?: boolean;
  preferredNotificationChannel?: 'telegram' | 'teams' | 'outlook';
  outputFormat?: 'decorator-typescript' | 'sdk-json' | 'both';
}

type NodeRole = 'main' | 'aiSubNode' | 'error';
type WorkflowParameters = NonNullable<NodeJSON['parameters']>;

interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  version: number;
  position: [number, number];
  config: WorkflowParameters;
  credentials?: NodeJSON['credentials'];
  role: NodeRole;
  aiRole?: 'ai_languageModel' | 'ai_memory' | 'ai_tool' | 'ai_vectorStore';
  communityPackage?: string;
}

interface WorkflowPlan {
  id: string;
  name: string;
  errorWorkflowId?: string;
  nodes: WorkflowNode[];
}

const CREDENTIAL_PLACEHOLDERS: Record<string, Record<string, { id: string; name: string }>> = {
  'n8n-nodes-base.bitrix24': {
    bitrix24OAuth2Api: { id: 'BITRIX24_CREDENTIAL_ID', name: 'Bitrix24 account' },
  },
  'n8n-nodes-base.microsoftTeams': {
    microsoftTeamsOAuth2Api: { id: 'MICROSOFT_TEAMS_CREDENTIAL_ID', name: 'Microsoft Teams account' },
  },
  'n8n-nodes-base.microsoftOutlook': {
    microsoftOutlookOAuth2Api: { id: 'MICROSOFT_OUTLOOK_CREDENTIAL_ID', name: 'Microsoft Outlook account' },
  },
  'n8n-nodes-base.microsoftOutlookTrigger': {
    microsoftOutlookOAuth2Api: { id: 'MICROSOFT_OUTLOOK_CREDENTIAL_ID', name: 'Microsoft Outlook account' },
  },
  'n8n-nodes-base.telegram': {
    telegramApi: { id: 'TELEGRAM_CREDENTIAL_ID', name: 'Telegram Bot' },
  },
  'n8n-nodes-base.telegramTrigger': {
    telegramApi: { id: 'TELEGRAM_CREDENTIAL_ID', name: 'Telegram Bot' },
  },
  'n8n-nodes-base.googleSheets': {
    googleSheetsOAuth2Api: { id: 'GOOGLE_SHEETS_CREDENTIAL_ID', name: 'Google Sheets account' },
  },
  'n8n-nodes-base.googleDrive': {
    googleDriveOAuth2Api: { id: 'GOOGLE_DRIVE_CREDENTIAL_ID', name: 'Google Drive account' },
  },
  '@n8n/n8n-nodes-langchain.lmChatOpenAi': {
    openAiApi: { id: 'OPENAI_CREDENTIAL_ID', name: 'OpenAI account' },
  },
  '@n8n/n8n-nodes-langchain.vectorStoreQdrant': {
    qdrantApi: { id: 'QDRANT_CREDENTIAL_ID', name: 'Qdrant account' },
  },
};

const COMMUNITY_NODE_PACKAGES: Record<string, string> = {
  'n8n-nodes-docxtemplater.docxtemplater': 'n8n-nodes-docxtemplater',
  '@n8n/n8n-nodes-langchain.vectorStoreQdrant': 'built-in LangChain Qdrant node or installed Qdrant community package',
};

export async function designWorkflow(args: DesignWorkflowArgs): Promise<string> {
  const {
    description,
    workflowId,
    workflowName,
    includeErrorHandling = true,
    errorWorkflowId,
    idiomaticMode = true,
    enableCommunityNodes = true,
    preferredNotificationChannel = 'telegram',
    outputFormat = 'decorator-typescript',
  } = args;

  const id = workflowId || `wf_${uuidv4().split('-')[0]}`;
  const name = workflowName || description.split('.')[0].substring(0, 50);
  const resolvedErrorWorkflowId = includeErrorHandling
    ? errorWorkflowId || `${id}_errors`
    : undefined;
  const plan = buildWorkflowPlan({
    id,
    name,
    description,
    errorWorkflowId: resolvedErrorWorkflowId,
    idiomaticMode,
    enableCommunityNodes,
    preferredNotificationChannel,
  });

  const code = generateWorkflowCode(plan, description, includeErrorHandling, preferredNotificationChannel);

  if (outputFormat === 'decorator-typescript') {
    return code;
  }

  const workflowJson = buildSdkWorkflowJson(plan);
  const serializedWorkflow = JSON.stringify(workflowJson, null, 2);

  if (outputFormat === 'sdk-json') {
    return serializedWorkflow;
  }

  return `${code}\n\n/* SDK-normalized workflow JSON generated with @n8n/workflow-sdk\n${serializedWorkflow}\n*/\n`;
}

function buildSdkWorkflowJson(plan: WorkflowPlan): WorkflowJSON {
  return sdkWorkflow.fromJSON(buildWorkflowJson(plan)).toJSON({ tidyUp: true });
}

function buildWorkflowJson(plan: WorkflowPlan): WorkflowJSON {
  return {
    id: plan.id,
    name: plan.name,
    nodes: plan.nodes.map(toWorkflowJsonNode),
    connections: buildWorkflowJsonConnections(plan.nodes),
    settings: {
      executionOrder: 'v1',
      callerPolicy: 'workflowsFromSameOwner',
      ...(plan.errorWorkflowId ? { errorWorkflow: plan.errorWorkflowId } : {}),
    },
  };
}

function toWorkflowJsonNode(workflowNode: WorkflowNode): NodeJSON {
  return {
    id: workflowNode.id,
    name: workflowNode.name,
    type: workflowNode.type,
    typeVersion: workflowNode.version,
    position: workflowNode.position,
    parameters: workflowNode.config,
    ...(workflowNode.credentials ? { credentials: workflowNode.credentials } : {}),
  };
}

function buildWorkflowJsonConnections(nodes: WorkflowNode[]): WorkflowJSON['connections'] {
  const connections: WorkflowJSON['connections'] = {};
  const mainNodes = nodes.filter((workflowNode) => workflowNode.role === 'main');

  for (let index = 0; index < mainNodes.length - 1; index += 1) {
    connections[mainNodes[index].name] = {
      main: [[{ node: mainNodes[index + 1].name, type: 'main', index: 0 }]],
    };
  }

  const agent = nodes.find((workflowNode) => workflowNode.type === '@n8n/n8n-nodes-langchain.agent');
  if (agent) {
    for (const subNode of nodes.filter((workflowNode) => workflowNode.role === 'aiSubNode' && workflowNode.aiRole)) {
      if (!subNode.aiRole) {
        continue;
      }
      connections[subNode.name] = {
        [subNode.aiRole]: [[{ node: agent.name, type: subNode.aiRole, index: 0 }]],
      };
    }
  }

  return connections;
}

function buildWorkflowPlan(args: {
  id: string;
  name: string;
  description: string;
  errorWorkflowId?: string;
  idiomaticMode: boolean;
  enableCommunityNodes: boolean;
  preferredNotificationChannel: 'telegram' | 'teams' | 'outlook';
}): WorkflowPlan {
  const lower = args.description.toLowerCase();
  const nodes: WorkflowNode[] = [];
  const trigger = analyzeTrigger(lower);

  nodes.push(trigger);

  if (needsSetTransform(lower)) {
    nodes.push(createSetNode(nodes.length));
  }

  if (lower.includes('bitrix') || lower.includes('crm')) {
    nodes.push(createBitrixNode(nodes.length));
  }

  if (lower.includes('docx') || lower.includes('document') || lower.includes('template')) {
    nodes.push(createDocxtemplaterNode(nodes.length, args.enableCommunityNodes));
  }

  if (lower.includes('ai') || lower.includes('agent') || lower.includes('openai') || lower.includes('gpt') || lower.includes('llm')) {
    nodes.push(...createAiAgentNodes(nodes.length, lower, args.enableCommunityNodes));
  }

  if (lower.includes('qdrant') && !nodes.some((node) => node.type.includes('vectorStoreQdrant'))) {
    nodes.push(createQdrantNode(nodes.length, args.enableCommunityNodes, false));
  }

  if (lower.includes('google sheet') || lower.includes('sheets')) {
    nodes.push(createGoogleSheetsNode(nodes.length));
  } else if (lower.includes('google') || lower.includes('drive')) {
    nodes.push(createGoogleDriveNode(nodes.length));
  }

  if (lower.includes('email') || lower.includes('outlook')) {
    nodes.push(createOutlookNode(nodes.length));
  }

  if (lower.includes('teams') || lower.includes('slack') || lower.includes('telegram') || lower.includes('notify') || lower.includes('alert')) {
    nodes.push(createNotificationNode(nodes.length, args.preferredNotificationChannel, lower));
  }

  if (lower.includes('filter') || lower.includes('validate') || lower.includes('check')) {
    nodes.splice(1, 0, createIfNode(1));
    repositionNodes(nodes);
  }

  if (nodes.filter((node) => node.role === 'main').length === 1) {
    nodes.push(createSetNode(nodes.length));
  }

  return {
    id: args.id,
    name: args.name,
    errorWorkflowId: args.errorWorkflowId,
    nodes,
  };
}

function analyzeTrigger(lower: string): WorkflowNode {
  if (lower.includes('schedule') || lower.includes('cron') || lower.includes('daily') || lower.includes('hourly')) {
    return {
      id: 'node-trigger',
      name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger',
      version: 1.2,
      position: [200, 300],
      role: 'main',
      config: {
        rule: { interval: [{ field: 'hours', hoursInterval: 24 }] },
      },
    };
  }

  if (lower.includes('telegram') && (lower.includes('incoming') || lower.includes('trigger') || lower.includes('bot'))) {
    return withCredentials({
      id: 'node-trigger',
      name: 'Telegram Trigger',
      type: 'n8n-nodes-base.telegramTrigger',
      version: 1.2,
      position: [200, 300],
      role: 'main',
      config: { updates: ['message'] },
    });
  }

  if (lower.includes('email') && (lower.includes('incoming') || lower.includes('received') || lower.includes('trigger'))) {
    return withCredentials({
      id: 'node-trigger',
      name: 'Outlook Trigger',
      type: 'n8n-nodes-base.microsoftOutlookTrigger',
      version: 1,
      position: [200, 300],
      role: 'main',
      config: { event: 'messageReceived', filters: {} },
    });
  }

  if (lower.includes('chat') || lower.includes('ai agent')) {
    return {
      id: 'node-trigger',
      name: 'Chat Trigger',
      type: '@n8n/n8n-nodes-langchain.chatTrigger',
      version: 1.1,
      position: [200, 300],
      role: 'main',
      config: {},
    };
  }

  if (lower.includes('manual')) {
    return {
      id: 'node-trigger',
      name: 'Manual Trigger',
      type: 'n8n-nodes-base.manualTrigger',
      version: 1,
      position: [200, 300],
      role: 'main',
      config: {},
    };
  }

  return {
    id: 'node-trigger',
    name: 'Webhook Trigger',
    type: 'n8n-nodes-base.webhook',
    version: 2,
    position: [200, 300],
    role: 'main',
    config: {
      httpMethod: 'POST',
      path: `webhook-${uuidv4().split('-')[0]}`,
      responseMode: 'onReceived',
      options: {},
    },
  };
}

function needsSetTransform(lower: string): boolean {
  return ['set ', 'map ', 'mapping', 'rename', 'format', 'prepare', 'extract', 'fields', 'transform'].some((term) => lower.includes(term));
}

function createSetNode(index: number): WorkflowNode {
  return {
    id: 'node-set',
    name: 'Prepare Data',
    type: 'n8n-nodes-base.set',
    version: 3.4,
    position: positionFor(index),
    role: 'main',
    config: {
      mode: 'manual',
      duplicateItem: false,
      assignments: {
        assignments: [
          { id: 'assign-summary', name: 'summary', value: '={{ $json.body || $json.text || $json }}', type: 'string' },
        ],
      },
    },
  };
}

function createBitrixNode(index: number): WorkflowNode {
  return withCredentials({
    id: 'node-bitrix',
    name: 'Bitrix24 CRM Action',
    type: 'n8n-nodes-base.bitrix24',
    version: 1,
    position: positionFor(index),
    role: 'main',
    config: {
      resource: 'lead',
      operation: 'create',
      fields: {
        TITLE: '={{ $json.title || $json.summary }}',
        NAME: '={{ $json.name }}',
        COMMENTS: '={{ $json.summary }}',
      },
    },
  });
}

function createDocxtemplaterNode(index: number, enabled: boolean): WorkflowNode {
  const node: WorkflowNode = {
    id: 'node-docxtemplater',
    name: 'Generate DOCX',
    type: 'n8n-nodes-docxtemplater.docxtemplater',
    version: 1,
    position: positionFor(index),
    role: 'main',
    communityPackage: COMMUNITY_NODE_PACKAGES['n8n-nodes-docxtemplater.docxtemplater'],
    config: {
      templateFile: '={{ $binary.template }}',
      data: '={{ $json }}',
      outputFileName: '={{ $json.fileName || "document.docx" }}',
    },
  };

  if (!enabled) {
    node.config = { note: 'Community node disabled. Install n8n-nodes-docxtemplater or replace this node.' };
  }

  return node;
}

function createAiAgentNodes(index: number, lower: string, enableCommunityNodes: boolean): WorkflowNode[] {
  const agent: WorkflowNode = {
    id: 'node-ai-agent',
    name: 'AI Agent',
    type: '@n8n/n8n-nodes-langchain.agent',
    version: 1.7,
    position: positionFor(index),
    role: 'main',
    config: {
      text: '={{ $json.summary || $json.text || $json.body || JSON.stringify($json) }}',
      options: {
        systemMessage: 'You are an automation assistant. Return concise structured output for the next n8n node.',
      },
    },
  };

  const model = withCredentials({
    id: 'node-openai-model',
    name: 'OpenAI Chat Model',
    type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
    version: 1.2,
    position: [positionFor(index)[0], 520],
    role: 'aiSubNode',
    aiRole: 'ai_languageModel',
    config: { model: 'gpt-4o-mini', options: { temperature: 0.3 } },
  });

  const memory: WorkflowNode = {
    id: 'node-memory',
    name: 'Conversation Memory',
    type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
    version: 1.3,
    position: [positionFor(index)[0] + 220, 520],
    role: 'aiSubNode',
    aiRole: 'ai_memory',
    config: { sessionKey: '={{ $execution.id }}', contextWindowLength: 10 },
  };

  const nodes = [agent, model, memory];

  if (lower.includes('qdrant') || lower.includes('vector') || lower.includes('rag')) {
    nodes.push(createQdrantNode(index + 1, enableCommunityNodes, true));
  }

  return nodes;
}

function createQdrantNode(index: number, enabled: boolean, asSubNode: boolean): WorkflowNode {
  const node = withCredentials({
    id: 'node-qdrant',
    name: 'Qdrant Vector Store',
    type: '@n8n/n8n-nodes-langchain.vectorStoreQdrant',
    version: 1,
    position: asSubNode ? [positionFor(index)[0] + 440, 520] : positionFor(index),
    role: asSubNode ? 'aiSubNode' : 'main',
    aiRole: asSubNode ? 'ai_vectorStore' : undefined,
    communityPackage: COMMUNITY_NODE_PACKAGES['@n8n/n8n-nodes-langchain.vectorStoreQdrant'],
    config: {
      mode: 'retrieve',
      qdrantCollection: '={{ $env.QDRANT_COLLECTION }}',
      topK: 5,
    },
  });

  if (!enabled) {
    node.config = { note: 'Qdrant node disabled. Install/enable Qdrant node support before deployment.' };
  }

  return node;
}

function createGoogleSheetsNode(index: number): WorkflowNode {
  return withCredentials({
    id: 'node-google-sheets',
    name: 'Append Google Sheet Row',
    type: 'n8n-nodes-base.googleSheets',
    version: 4.5,
    position: positionFor(index),
    role: 'main',
    config: {
      operation: 'append',
      documentId: '={{ $env.GOOGLE_SHEET_ID }}',
      sheetName: 'Sheet1',
      columns: { mappingMode: 'autoMapInputData' },
    },
  });
}

function createGoogleDriveNode(index: number): WorkflowNode {
  return withCredentials({
    id: 'node-google-drive',
    name: 'Google Drive Action',
    type: 'n8n-nodes-base.googleDrive',
    version: 3,
    position: positionFor(index),
    role: 'main',
    config: { resource: 'file', operation: 'upload' },
  });
}

function createOutlookNode(index: number): WorkflowNode {
  return withCredentials({
    id: 'node-outlook',
    name: 'Send Outlook Email',
    type: 'n8n-nodes-base.microsoftOutlook',
    version: 2,
    position: positionFor(index),
    role: 'main',
    config: {
      resource: 'message',
      operation: 'send',
      toRecipients: '={{ $json.email }}',
      subject: '={{ $json.subject || "n8n automation update" }}',
      bodyContent: '={{ $json.body || $json.summary }}',
      bodyContentType: 'HTML',
    },
  });
}

function createNotificationNode(index: number, preferred: 'telegram' | 'teams' | 'outlook', lower: string): WorkflowNode {
  if (preferred === 'teams' || lower.includes('teams')) {
    return withCredentials({
      id: 'node-notify',
      name: 'Notify Teams Channel',
      type: 'n8n-nodes-base.microsoftTeams',
      version: 2,
      position: positionFor(index),
      role: 'main',
      config: {
        resource: 'chatMessage',
        operation: 'create',
        teamId: '={{ $env.TEAMS_TEAM_ID }}',
        channelId: '={{ $env.TEAMS_CHANNEL_ID }}',
        contentType: 'html',
        message: '=<b>n8n update:</b> {{ $json.summary || $json.message || JSON.stringify($json) }}',
      },
    });
  }

  if (preferred === 'outlook') {
    return createOutlookNode(index);
  }

  return withCredentials({
    id: 'node-notify',
    name: 'Send Telegram Alert',
    type: 'n8n-nodes-base.telegram',
    version: 1.2,
    position: positionFor(index),
    role: 'main',
    config: {
      operation: 'sendMessage',
      chatId: '={{ $env.TG_ERROR_CHAT_ID }}',
      text: '=n8n update: {{ $json.summary || $json.message || JSON.stringify($json) }}',
      additionalFields: { parse_mode: 'Markdown', disable_web_page_preview: true },
    },
  });
}

function createIfNode(index: number): WorkflowNode {
  return {
    id: 'node-validate',
    name: 'Validate Input',
    type: 'n8n-nodes-base.if',
    version: 2,
    position: positionFor(index),
    role: 'main',
    config: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          {
            id: 'condition-has-payload',
            leftValue: '={{ $json.body || $json.text || $json }}',
            rightValue: '',
            operator: { type: 'string', operation: 'notEmpty' },
          },
        ],
        combinator: 'and',
      },
    },
  };
}

function generateWorkflowCode(
  plan: WorkflowPlan,
  description: string,
  includeErrorHandling: boolean,
  preferredNotificationChannel: 'telegram' | 'teams' | 'outlook',
): string {
  const className = generateClassName(plan.name);
  const propertyNames = createPropertyNameMap(plan.nodes);
  const communityNodes = plan.nodes.filter((node) => node.communityPackage);
  let code = `import { workflow, node, links } from '@n8n-as-code/transformer';\n\n`;
  code += `// Generated from: ${escapeComment(description)}\n`;
  code += `// Idiomatic n8n defaults: native nodes over HTTP Request, credential references, Set nodes for simple transforms, AI Agent sub-nodes, errorWorkflow settings.\n`;
  if (communityNodes.length > 0) {
    code += `// Community nodes required: ${communityNodes.map((node) => `${node.type} (${node.communityPackage})`).join(', ')}.\n`;
  }
  code += `// Workflow ID: ${plan.id}\n\n`;
  code += `@workflow({\n`;
  code += `    id: '${plan.id}',\n`;
  code += `    name: '${escapeString(plan.name)}',\n`;
  code += `    active: false,\n`;
  code += `    settings: ${formatObject({ executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner', ...(plan.errorWorkflowId ? { errorWorkflow: plan.errorWorkflowId } : {}) }, 4)}\n`;
  code += `})\n`;
  code += `export class ${className} {\n`;

  for (const workflowNode of plan.nodes) {
    code += generateNodeCode(workflowNode, propertyNames.get(workflowNode.id) || sanitizePropertyName(workflowNode.name));
  }

  code += `\n    @links()\n`;
  code += `    defineRouting() {\n`;
  code += generateMainConnections(plan.nodes, propertyNames);
  code += generateAiConnections(plan.nodes, propertyNames);
  code += `    }\n`;
  code += `}\n`;

  if (includeErrorHandling && plan.errorWorkflowId) {
    code += generateErrorWorkflow(plan.errorWorkflowId, preferredNotificationChannel);
  }

  return code;
}

function generateNodeCode(workflowNode: WorkflowNode, propertyName: string): string {
  let code = `\n    @node({\n`;
  code += `        id: '${workflowNode.id}',\n`;
  code += `        name: '${escapeString(workflowNode.name)}',\n`;
  code += `        type: '${workflowNode.type}',\n`;
  code += `        version: ${workflowNode.version},\n`;
  code += `        position: [${workflowNode.position[0]}, ${workflowNode.position[1]}]`;
  if (workflowNode.credentials) {
    code += `,\n        credentials: ${formatObject(workflowNode.credentials, 8)}\n`;
  } else {
    code += `\n`;
  }
  code += `    })\n`;
  code += `    ${propertyName} = ${formatObject(workflowNode.config, 4)};\n`;
  return code;
}

function generateMainConnections(nodes: WorkflowNode[], propertyNames: Map<string, string>): string {
  const mainNodes = nodes.filter((workflowNode) => workflowNode.role === 'main');
  let connections = '';

  for (let index = 0; index < mainNodes.length - 1; index += 1) {
    const from = propertyNames.get(mainNodes[index].id);
    const to = propertyNames.get(mainNodes[index + 1].id);
    if (from && to) {
      connections += `        this.${from}.out(0).to(this.${to}.in(0));\n`;
    }
  }

  return connections;
}

function generateAiConnections(nodes: WorkflowNode[], propertyNames: Map<string, string>): string {
  const agent = nodes.find((workflowNode) => workflowNode.type === '@n8n/n8n-nodes-langchain.agent');
  if (!agent) {
    return '';
  }

  const grouped = nodes
    .filter((workflowNode) => workflowNode.role === 'aiSubNode' && workflowNode.aiRole)
    .reduce<Record<string, string[]>>((accumulator, workflowNode) => {
      const propertyName = propertyNames.get(workflowNode.id);
      if (!propertyName || !workflowNode.aiRole) {
        return accumulator;
      }

      accumulator[workflowNode.aiRole] = accumulator[workflowNode.aiRole] || [];
      accumulator[workflowNode.aiRole].push(`this.${propertyName}.output`);
      return accumulator;
    }, {});

  const agentProperty = propertyNames.get(agent.id);
  if (!agentProperty || Object.keys(grouped).length === 0) {
    return '';
  }

  const lines = Object.entries(grouped).map(([role, outputs]) => {
    const value = outputs.length === 1 && role !== 'ai_tool' ? outputs[0] : `[${outputs.join(', ')}]`;
    return `            ${role}: ${value}`;
  });

  return `        this.${agentProperty}.uses({\n${lines.join(',\n')}\n        });\n`;
}

function generateErrorWorkflow(errorWorkflowId: string, preferredNotificationChannel: 'telegram' | 'teams' | 'outlook'): string {
  const alertNode = createNotificationNode(1, preferredNotificationChannel, preferredNotificationChannel);
  alertNode.id = 'error-alert';
  alertNode.name = preferredNotificationChannel === 'teams' ? 'Notify Teams Error Channel' : preferredNotificationChannel === 'outlook' ? 'Send Error Email' : 'Send Telegram Error Alert';
  alertNode.position = [450, 300];
  if (alertNode.type === 'n8n-nodes-base.telegram') {
    alertNode.config.text = '=🔴 n8n workflow error: {{ $json.error.message }}';
  }

  const errorTrigger: WorkflowNode = {
    id: 'error-trigger',
    name: 'Error Trigger',
    type: 'n8n-nodes-base.errorTrigger',
    version: 1,
    position: [200, 300],
    role: 'error',
    config: {},
  };
  const propertyNames = createPropertyNameMap([errorTrigger, alertNode]);
  const errorClassName = generateClassName(`${errorWorkflowId} Handler`);

  let code = `\n@workflow({\n`;
  code += `    id: '${errorWorkflowId}',\n`;
  code += `    name: '${escapeString(errorWorkflowId)} Error Handler',\n`;
  code += `    active: false,\n`;
  code += `    settings: { executionOrder: 'v1' }\n`;
  code += `})\n`;
  code += `export class ${errorClassName} {\n`;
  code += generateNodeCode(errorTrigger, propertyNames.get(errorTrigger.id) || 'ErrorTrigger');
  code += generateNodeCode(alertNode, propertyNames.get(alertNode.id) || 'SendAlert');
  code += `\n    @links()\n`;
  code += `    defineRouting() {\n`;
  code += `        this.${propertyNames.get(errorTrigger.id)}.out(0).to(this.${propertyNames.get(alertNode.id)}.in(0));\n`;
  code += `    }\n`;
  code += `}\n`;
  return code;
}

function withCredentials(workflowNode: WorkflowNode): WorkflowNode {
  const credentials = CREDENTIAL_PLACEHOLDERS[workflowNode.type];
  if (!credentials) {
    return workflowNode;
  }

  return {
    ...workflowNode,
    credentials,
  };
}

function repositionNodes(nodes: WorkflowNode[]): void {
  let mainIndex = 0;
  for (const workflowNode of nodes) {
    if (workflowNode.role === 'main') {
      workflowNode.position = positionFor(mainIndex);
      mainIndex += 1;
    }
  }
}

function positionFor(index: number): [number, number] {
  return [200 + index * 250, 300];
}

function createPropertyNameMap(nodes: WorkflowNode[]): Map<string, string> {
  const used = new Map<string, number>();
  const result = new Map<string, string>();

  for (const workflowNode of nodes) {
    const baseName = sanitizePropertyName(workflowNode.name);
    const count = used.get(baseName) || 0;
    used.set(baseName, count + 1);
    result.set(workflowNode.id, count === 0 ? baseName : `${baseName}${count + 1}`);
  }

  return result;
}

function sanitizePropertyName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

  return /^\d/.test(cleaned) ? `Node${cleaned}` : cleaned || 'Node';
}

function generateClassName(name: string): string {
  const className = sanitizePropertyName(name);
  return className.endsWith('Workflow') ? className : `${className}Workflow`;
}

function formatObject(value: unknown, indent: number): string {
  return JSON.stringify(value, null, 4)
    .replace(/"([^"]+)":/g, '$1:')
    .split('\n')
    .map((line, index) => (index === 0 ? line : `${' '.repeat(indent)}${line}`))
    .join('\n');
}

function escapeString(str: string): string {
  return str.replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function escapeComment(str: string): string {
  return str.replace(/\n/g, ' ').replace(/\*\//g, '* /');
}
