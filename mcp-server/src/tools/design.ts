import { v4 as uuidv4 } from 'uuid';
import { workflow as sdkWorkflow, type NodeJSON, type WorkflowJSON } from '@n8n/workflow-sdk';
import { CREDENTIAL_PLACEHOLDERS, communityPackageFor } from './node-registry.js';

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

type NodeRole = 'main' | 'aiSubNode' | 'error' | 'note';
type WorkflowParameters = NonNullable<NodeJSON['parameters']>;

interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  version: number;
  position: [number, number];
  config: WorkflowParameters;
  credentials?: NodeJSON['credentials'];
  settings?: {
    continueOnFail?: boolean;
    retryOnFail?: boolean;
    maxTries?: number;
    waitBetweenTries?: number;
  };
  role: NodeRole;
  aiRole?: 'ai_languageModel' | 'ai_memory' | 'ai_tool' | 'ai_vectorStore';
  communityPackage?: string;
}

type IntentId =
  | 'filter'
  | 'if'
  | 'switch'
  | 'sort'
  | 'limit'
  | 'removeDuplicates'
  | 'splitOut'
  | 'aggregate'
  | 'summarize'
  | 'merge'
  | 'compareDatasets'
  | 'renameKeys';

type IntentConflictGroup = 'conditional' | 'ordering' | 'collection' | 'combination' | 'field-operation';

interface IntentRule {
  intent: IntentId;
  nodeType: string;
  baseConfidence: number;
  priority: number;
  conflictGroup?: IntentConflictGroup;
  exactPhrases?: readonly string[];
  weakSignals?: readonly string[];
  strongSignals: readonly string[];
  supportingSignals: readonly string[];
  negativeSignals?: readonly string[];
}

interface NodeCandidate {
  intent: IntentId;
  nodeType: string;
  confidence: number;
  priority: number;
  matchedSignals: readonly string[];
  supportingSignals: readonly string[];
  conflictGroup?: IntentConflictGroup;
  reason: string;
}

const HIGH_CONFIDENCE_THRESHOLD = 0.75;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.6;

const INTENT_RULES: readonly IntentRule[] = [
  {
    intent: 'filter',
    nodeType: 'n8n-nodes-base.filter',
    baseConfidence: 0.68,
    priority: 90,
    conflictGroup: 'conditional',
    strongSignals: ['filter', 'фильтр', 'оставить только', 'отфильтровать', 'исключить', 'отсеять'],
    supportingSignals: ['only', 'active', 'paid', 'оплаченные'],
  },
  {
    intent: 'if',
    nodeType: 'n8n-nodes-base.if',
    baseConfidence: 0.62,
    priority: 80,
    conflictGroup: 'conditional',
    strongSignals: ['if', 'если', 'validate', 'check', 'проверить', 'валидация', 'проверка'],
    supportingSignals: ['condition', 'boolean'],
    negativeSignals: ['filter', 'оставить только'],
  },
  {
    intent: 'switch',
    nodeType: 'n8n-nodes-base.switch',
    baseConfidence: 0.7,
    priority: 95,
    conflictGroup: 'conditional',
    strongSignals: [
      'switch', 'маршрутизировать', 'ветки', 'branching', 'route', 'routing', 'rules', 'в зависимости от',
      'статус+paid', 'статус+expired', 'статус+error', 'статус+pending', 'статус+success', 'статус+approved', 'статус+rejected',
      'status+paid', 'status+expired', 'status+error', 'status+pending', 'status+success', 'status+approved', 'status+rejected'
    ],
    supportingSignals: ['status', 'статус', 'paid', 'expired', 'error', 'pending', 'success', 'approved', 'rejected', 'ветки', 'разделить по', 'ветвление', 'route by', 'branch by', 'different paths'],
  },
  {
    intent: 'sort',
    nodeType: 'n8n-nodes-base.sort',
    baseConfidence: 0.66,
    priority: 80,
    conflictGroup: 'ordering',
    strongSignals: [
      'sort', 'сортиров', 'отсортировать', 'упорядочить', 'order by',
      'сравнить+цен', 'сравнить+стоимост', 'сравнить+cost', 'сравнить+price', 'сравнить+rates',
      'compare+price', 'compare+cost', 'compare+rates'
    ],
    supportingSignals: ['by date', 'по дате', 'by name', 'по имени', 'best', 'cheapest', 'лучший', 'выбрать', 'select', 'дешевый', 'сравнить', 'compare'],
  },
  {
    intent: 'limit',
    nodeType: 'n8n-nodes-base.limit',
    baseConfidence: 0.64,
    priority: 70,
    conflictGroup: 'ordering',
    strongSignals: ['limit', 'лимит', 'first', 'top', 'первые', 'последние', 'ограничить количество'],
    supportingSignals: ['last', '5 items', '10 items'],
  },
  {
    intent: 'removeDuplicates',
    nodeType: 'n8n-nodes-base.removeDuplicates',
    baseConfidence: 0.72,
    priority: 90,
    conflictGroup: 'collection',
    strongSignals: ['remove duplicates', 'dedupe', 'de-duplicate', 'дубликат', 'уникальн', 'очистить от дублей', 'убрать дубли'],
    supportingSignals: ['unique', 'by email', 'по email'],
  },
  {
    intent: 'splitOut',
    nodeType: 'n8n-nodes-base.splitOut',
    baseConfidence: 0.7,
    priority: 88,
    conflictGroup: 'collection',
    strongSignals: [
      'split out', 'split array', 'разбить массив', 'for each item', 'каждый элемент массива',
      'разбить список', 'цикл по элементам', 'разбить+массив', 'разбить+список', 'разбить+товары', 'разбить+заказы', 'разбить+строки',
      'split+array', 'split+list', 'split+items', 'split+elements', 'split+rows'
    ],
    supportingSignals: ['array', 'list', 'items', 'elements', 'товары', 'заказы', 'rows', 'строки таблицы', 'разбить', 'split'],
  },
  {
    intent: 'aggregate',
    nodeType: 'n8n-nodes-base.aggregate',
    baseConfidence: 0.66,
    priority: 76,
    conflictGroup: 'collection',
    strongSignals: [
      'aggregate', 'агрегировать', 'собрать в список', 'collect to list', 'combine into array', 'группировать в список', 'group to list',
      'объединить+текст', 'объединить+строки', 'объединить+сообщения', 'объединить+комментарии', 'объединить+письмо', 'объединить+строку',
      'join+text', 'join+string', 'join+message', 'join+comment', 'join+email',
      'combine+text', 'combine+string', 'combine+message', 'combine+comment', 'combine+email'
    ],
    supportingSignals: ['объединить', 'join', 'combine', 'текст', 'строки', 'text', 'string', 'into one string', 'в одну строку'],
    negativeSignals: ['sum all', 'total amount', 'сумм'],
  },
  {
    intent: 'summarize',
    nodeType: 'n8n-nodes-base.summarize',
    baseConfidence: 0.68,
    priority: 84,
    conflictGroup: 'collection',
    strongSignals: [
      'summarize', 'sum all', 'total sum', 'total amount', 'посчитать сумму',
      'посчитать+сумму', 'calculate+sum', 'calculate+total', 'calculate+average', 'calculate+count',
      'посчитать+среднее', 'посчитать+количество'
    ],
    supportingSignals: ['average', 'mean', 'count', 'сумм', 'средн', 'общее', 'посчитать', 'calculate'],
    negativeSignals: ['per item', 'each', 'для каждого', 'комисси', 'налог', 'скидк', 'commission', 'tax', 'discount', 'прибыль', 'difference', 'построчно', 'row-by-row'],
  },
  {
    intent: 'merge',
    nodeType: 'n8n-nodes-base.merge',
    baseConfidence: 0.66,
    priority: 78,
    conflictGroup: 'combination',
    strongSignals: [
      'merge', 'merge streams', 'join streams', 'объединить потоки', 'соединить данные',
      'объединить+потоки', 'объединить+ветки', 'объединить+источники', 'объединить+таблицы', 'объединить+файлы', 'объединить+данные',
      'join+streams', 'join+branches', 'join+sources', 'join+tables', 'join+files', 'join+data',
      'combine+streams', 'combine+branches', 'combine+sources', 'combine+tables', 'combine+files', 'combine+data'
    ],
    supportingSignals: ['streams', 'branches', 'sources', 'tables', 'потоки', 'ветки', 'источники', 'объединить', 'join', 'combine'],
    negativeSignals: ['aggregate', 'агрегировать', 'собрать в список', 'collect to list', 'combine into array', 'группировать в список', 'group to list'],
  },
  {
    intent: 'compareDatasets',
    nodeType: 'n8n-nodes-base.compareDatasets',
    baseConfidence: 0.68,
    priority: 82,
    conflictGroup: 'combination',
    strongSignals: [
      'compare datasets', 'diff', 'find changes', 'сравнить данные', 'сравнить таблицы', 'сравнить два файла', 'compare two lists', 'сравнить списки',
      'сравнить+списк', 'сравнить+таблиц', 'сравнить+файл', 'сравнить+баз', 'сравнить+данные', 'сравнить+данных',
      'compare+datasets', 'compare+lists', 'compare+tables', 'compare+files', 'compare+data'
    ],
    supportingSignals: ['datasets', 'lists', 'tables', 'данные', 'таблиц', 'списк', 'сравнить', 'compare'],
    negativeSignals: ['best', 'cheapest', 'лучший', 'цены', 'цену', 'cost', 'price', 'rates'],
  },
  {
    intent: 'renameKeys',
    nodeType: 'n8n-nodes-base.renameKeys',
    baseConfidence: 0.72,
    priority: 74,
    conflictGroup: 'field-operation',
    strongSignals: ['rename keys', 'rename fields', 'rename', 'переименовать поля', 'поменять названия полей'],
    supportingSignals: ['field names', 'keys'],
  },
];

interface WorkflowPlan {
  id: string;
  name: string;
  errorWorkflowId?: string;
  nodes: WorkflowNode[];
}

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

function toWorkflowJsonNode(workflowNode: WorkflowNode): NodeJSON & { settings?: any } {
  return {
    id: workflowNode.id,
    name: workflowNode.name,
    type: workflowNode.type,
    typeVersion: workflowNode.version,
    position: workflowNode.position,
    parameters: workflowNode.config,
    ...(workflowNode.credentials ? { credentials: workflowNode.credentials } : {}),
    ...(workflowNode.settings ? { settings: workflowNode.settings } : {}),
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
    nodes.push(createBitrixNode(nodes.length, args.enableCommunityNodes, lower));
  }

  if (
    lower.includes('convert document') ||
    lower.includes('convert file') ||
    lower.includes('parse document') ||
    lower.includes('file to text') ||
    lower.includes('pdf to text') ||
    lower.includes('pdf to markdown') ||
    lower.includes('docx to markdown') ||
    lower.includes('file converter') ||
    lower.includes('converter documents')
  ) {
    nodes.push(createConverterDocumentsNode(nodes.length, args.enableCommunityNodes));
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

  if (lower.includes('outlook')) {
    nodes.push(createOutlookNode(nodes.length));
  } else if (lower.includes('email') || lower.includes('smtp')) {
    nodes.push(createEmailSendNode(nodes.length));
  }

  if (lower.includes('teams') || lower.includes('slack') || lower.includes('telegram') || lower.includes('notify') || lower.includes('alert')) {
    nodes.push(createNotificationNode(nodes.length, args.preferredNotificationChannel, lower));
  }

  if (lower.includes('firecrawl') || lower.includes('scrape') || lower.includes('crawl')) {
    nodes.push(createFirecrawlNode(nodes.length, args.enableCommunityNodes));
  }

  if (lower.includes('puppeteer') || lower.includes('browser automation')) {
    nodes.push(createPuppeteerNode(nodes.length, args.enableCommunityNodes));
  }

  if (lower.includes('chatwoot')) {
    nodes.push(createChatwootNode(nodes.length, args.enableCommunityNodes));
  }

  if (lower.includes('palatine') || lower.includes('transcribe') || lower.includes('audio transcription') || lower.includes('voice message')) {
    nodes.push(createPalatineSpeechNode(nodes.length, args.enableCommunityNodes));
  }

  if (lower.includes('globals') || lower.includes('global constant')) {
    nodes.push(createGlobalsNode(nodes.length, args.enableCommunityNodes));
  }

  if (lower.includes('ocr') || lower.includes('tesseract') || lower.includes('extract text from image')) {
    nodes.push(createTesseractNode(nodes.length, args.enableCommunityNodes));
  }

  if (lower.includes('elevenlabs') || lower.includes('text to speech') || lower.includes('speech synthesis')) {
    nodes.push(createElevenLabsNode(nodes.length, args.enableCommunityNodes));
  }

  if (lower.includes('tavily') || lower.includes('ai search')) {
    nodes.push(createTavilyNode(nodes.length, args.enableCommunityNodes));
  }

  if (lower.includes('html to pdf') || lower.includes('pdf converter')) {
    nodes.push(createHtmlCssToPdfNode(nodes.length, args.enableCommunityNodes));
  }

  // Legacy inline conditional checks removed in favor of data-driven intent matching

  const intents = detectIntents(args.description);

  if (intents.has('filter')) {
    // Check if filter isn't already added (we keep legacy check above as a fallback, but we should make sure we don't duplicate)
    if (!nodes.some((n) => n.type === 'n8n-nodes-base.filter')) {
      nodes.splice(1, 0, createFilterNode(1));
      repositionNodes(nodes);
    }
  } else if (intents.has('if')) {
    if (!nodes.some((n) => n.type === 'n8n-nodes-base.if')) {
      nodes.splice(1, 0, createIfNode(1));
      repositionNodes(nodes);
    }
  }

  if (intents.has('switch')) {
    nodes.push(createSwitchNode(nodes.length));
  }

  if (intents.has('sort')) {
    nodes.push(createSortNode(nodes.length));
  }

  if (intents.has('limit')) {
    nodes.push(createLimitNode(nodes.length));
  }

  if (intents.has('removeDuplicates')) {
    nodes.push(createRemoveDuplicatesNode(nodes.length));
  }

  if (intents.has('splitOut')) {
    nodes.push(createSplitOutNode(nodes.length));
  }

  if (intents.has('aggregate')) {
    nodes.push(createAggregateNode(nodes.length));
  }

  if (intents.has('summarize')) {
    nodes.push(createSummarizeNode(nodes.length));
  }

  if (intents.has('merge')) {
    nodes.push(createMergeNode(nodes.length));
  }

  if (intents.has('compareDatasets')) {
    nodes.push(createCompareDatasetsNode(nodes.length));
  }

  if (intents.has('renameKeys')) {
    nodes.push(createRenameKeysNode(nodes.length));
  }

  if (lower.includes('code node') || lower.includes('javascript') || lower.includes('python') || lower.includes('run script')) {
    if (shouldAllowCodeNode(args.description)) {
      const isPython = lower.includes('python');
      nodes.push(createCodeNode(nodes.length, isPython ? 'python' : 'js'));
    } else {
      if (!nodes.some((node) => node.type === 'n8n-nodes-base.set')) {
        nodes.push(createSetNode(nodes.length));
      }
    }
  }

  if (nodes.filter((node) => node.role === 'main').length === 1) {
    nodes.push(createSetNode(nodes.length));
  }

  repositionNodes(nodes);

  applyNodeSettingsHeuristics(nodes, args.description);
  addStickyNotes(nodes, args.description, args.name);

  return {
    id: args.id,
    name: args.name,
    errorWorkflowId: args.errorWorkflowId,
    nodes,
  };
}

function detectIntents(description: string): Set<IntentId> {
  const lower = description.toLowerCase();
  const candidates: NodeCandidate[] = [];

  for (const rule of INTENT_RULES) {
    let strongMatchCount = 0;
    
    // Check strong signals
    for (const sig of rule.strongSignals) {
      const parts = sig.split('+');
      const allMatched = parts.every(part => lower.includes(part));
      if (allMatched) {
        strongMatchCount++;
      }
    }

    if (strongMatchCount === 0) {
      continue;
    }

    // Start with base confidence
    let confidence = rule.baseConfidence;

    // Boost for additional strong signals
    if (strongMatchCount > 1) {
      confidence += (strongMatchCount - 1) * 0.05;
    }

    // Check supporting signals
    let supportMatchCount = 0;
    for (const sig of rule.supportingSignals) {
      const parts = sig.split('+');
      const allMatched = parts.every(part => lower.includes(part));
      if (allMatched) {
        supportMatchCount++;
      }
    }
    confidence += supportMatchCount * 0.10;

    // Check negative signals
    if (rule.negativeSignals) {
      let negativeMatch = false;
      for (const sig of rule.negativeSignals) {
        const parts = sig.split('+');
        const allMatched = parts.every(part => lower.includes(part));
        if (allMatched) {
          negativeMatch = true;
          break;
        }
      }
      if (negativeMatch) {
        confidence = 0;
      }
    }

    // Clamp confidence to [0, 1]
    confidence = Math.min(Math.max(confidence, 0), 1.0);

    if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD) {
      candidates.push({
        intent: rule.intent,
        nodeType: rule.nodeType,
        confidence,
        priority: rule.priority,
        matchedSignals: rule.strongSignals.filter(sig => sig.split('+').every(part => lower.includes(part))),
        supportingSignals: rule.supportingSignals.filter(sig => sig.split('+').every(part => lower.includes(part))),
        conflictGroup: rule.conflictGroup,
        reason: `Matched strong signals [${rule.strongSignals.filter(sig => sig.split('+').every(part => lower.includes(part))).join(', ')}] with confidence ${confidence.toFixed(2)}`,
      });
    }
  }

  // Group by conflictGroup and select the winner of each group
  const grouped = new Map<string, NodeCandidate[]>();
  const nonConflicting: NodeCandidate[] = [];

  for (const cand of candidates) {
    if (cand.conflictGroup) {
      const list = grouped.get(cand.conflictGroup) || [];
      list.push(cand);
      grouped.set(cand.conflictGroup, list);
    } else {
      nonConflicting.push(cand);
    }
  }

  const winners: NodeCandidate[] = [...nonConflicting];

  for (const [_, list] of grouped.entries()) {
    list.sort((a, b) => {
      if (Math.abs(a.confidence - b.confidence) > 0.001) {
        return b.confidence - a.confidence;
      }
      return b.priority - a.priority;
    });
    winners.push(list[0]);
  }

  return new Set(winners.map(w => w.intent));
}

function applyNodeSettingsHeuristics(nodes: WorkflowNode[], description: string): void {
  const lower = description.toLowerCase();
  
  let retryOnFail = false;
  let maxTries = 3;
  let retryInterval = 5000;
  
  if (lower.includes('retry') || lower.includes('retries') || lower.includes('attempt')) {
    retryOnFail = true;
    const retryMatch = lower.match(/(?:retry|attempt|tries)\s*(\d+)\s*times?/i) || lower.match(/(\d+)\s*(?:retry|attempt|tries)/i);
    if (retryMatch) {
      maxTries = parseInt(retryMatch[1], 10);
    }
    const waitMatch = lower.match(/wait\s*(\d+)\s*(s|sec|second|seconds|ms|millisecond|milliseconds)/i);
    if (waitMatch) {
      const num = parseInt(waitMatch[1], 10);
      const unit = waitMatch[2].toLowerCase();
      if (unit.startsWith('ms') || unit.startsWith('milli')) {
        retryInterval = num;
      } else {
        retryInterval = num * 1000;
      }
    }
  }

  let continueOnFail = false;
  if (
    lower.includes('continue on fail') ||
    lower.includes('continue on error') ||
    lower.includes('ignore error') ||
    lower.includes('ignore errors') ||
    lower.includes('non-critical') ||
    lower.includes('optional step')
  ) {
    continueOnFail = true;
  }

  if (!retryOnFail && !continueOnFail) {
    return;
  }

  for (const node of nodes) {
    if (node.id === 'node-trigger' || node.role === 'aiSubNode' || node.role === 'error') {
      continue;
    }
    
    const isIntegrationNode = [
      'n8n-nodes-base.bitrix24',
      'n8n-nodes-bitrix.bitrix',
      '@mazix/n8n-nodes-converter-documents.converterDocuments',
      'n8n-nodes-base.microsoftTeams',
      'n8n-nodes-base.microsoftOutlook',
      'n8n-nodes-base.telegram',
      'n8n-nodes-base.googleSheets',
      'n8n-nodes-base.googleDrive',
      'n8n-nodes-base.httpRequest',
      'n8n-nodes-docxtemplater.docxtemplater',
      '@n8n/n8n-nodes-langchain.agent'
    ].some((type) => node.type.includes(type));

    if (isIntegrationNode) {
      node.settings = node.settings || {};
      if (continueOnFail) {
        node.settings.continueOnFail = true;
      }
      if (retryOnFail) {
        node.settings.retryOnFail = true;
        node.settings.maxTries = maxTries;
        node.settings.waitBetweenTries = retryInterval;
      }
    }
  }
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

  if (lower.includes('imap') || (lower.includes('email') && !lower.includes('outlook') && !lower.includes('gmail') && (lower.includes('incoming') || lower.includes('received') || lower.includes('trigger')))) {
    return withCredentials({
      id: 'node-trigger',
      name: 'Email Read IMAP',
      type: 'n8n-nodes-base.emailReadImap',
      version: 2.1,
      position: [200, 300],
      role: 'main',
      config: {
        onEmailReceived: 'nothing',
        downloadAttachments: false,
      },
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
  if (['set ', 'map ', 'mapping', 'rename', 'format', 'prepare', 'extract', 'fields', 'transform'].some((term) => lower.includes(term))) {
    return true;
  }
  // calculate field per item intent
  if (
    (lower.includes('посчитать') || lower.includes('вычислить') || lower.includes('calculate')) &&
    (lower.includes('для каждого') || lower.includes('каждого') || lower.includes('each') || lower.includes('per item') || lower.includes('построчно') || lower.includes('row-by-row'))
  ) {
    return true;
  }
  return false;
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

function createBitrixNode(index: number, enableCommunityNodes: boolean, lower: string): WorkflowNode {
  const useCommunity = enableCommunityNodes && (
    lower.includes('community bitrix') ||
    lower.includes('bitrix community') ||
    lower.includes('n8n-nodes-bitrix')
  );
  if (useCommunity) {
    return withCredentials({
      id: 'node-bitrix',
      name: 'Bitrix24 CRM Action',
      type: 'n8n-nodes-bitrix.bitrix',
      version: 1,
      position: positionFor(index),
      role: 'main',
      communityPackage: communityPackageFor('n8n-nodes-bitrix.bitrix'),
      config: {
        resource: 'crm.lead',
        operation: 'create',
        fields: {
          TITLE: '={{ $json.title || $json.summary }}',
          NAME: '={{ $json.name }}',
          COMMENTS: '={{ $json.summary }}',
        },
      },
    });
  }

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

function createConverterDocumentsNode(index: number, enabled: boolean): WorkflowNode {
  const node: WorkflowNode = {
    id: 'node-converter-documents',
    name: 'Document Converter',
    type: '@mazix/n8n-nodes-converter-documents.converterDocuments',
    version: 1,
    position: positionFor(index),
    role: 'main',
    communityPackage: communityPackageFor('@mazix/n8n-nodes-converter-documents.converterDocuments'),
    config: {
      binaryPropertyName: 'data',
    },
  };

  if (!enabled) {
    node.config = { note: 'Community node disabled. Install @mazix/n8n-nodes-converter-documents or replace this node.' };
  }

  return node;
}

function createDocxtemplaterNode(index: number, enabled: boolean): WorkflowNode {
  const node: WorkflowNode = {
    id: 'node-docxtemplater',
    name: 'Generate DOCX',
    type: 'n8n-nodes-docxtemplater.docxtemplater',
    version: 1,
    position: positionFor(index),
    role: 'main',
    communityPackage: communityPackageFor('n8n-nodes-docxtemplater.docxtemplater'),
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

function createFirecrawlNode(index: number, enabled: boolean): WorkflowNode {
  const node: WorkflowNode = withCredentials({
    id: 'node-firecrawl',
    name: 'Firecrawl Scraper',
    type: '@mendable/n8n-nodes-firecrawl.firecrawl',
    version: 1,
    position: positionFor(index),
    role: 'main',
    communityPackage: communityPackageFor('@mendable/n8n-nodes-firecrawl.firecrawl'),
    config: {
      operation: 'scrape',
      url: '={{ $json.url }}',
      options: {
        pageOptions: {
          onlyMainContent: true,
        },
      },
    },
  });

  if (!enabled) {
    node.config = { note: 'Community node disabled. Install @mendable/n8n-nodes-firecrawl or replace this node.' };
  }

  return node;
}

function createPuppeteerNode(index: number, enabled: boolean): WorkflowNode {
  const node: WorkflowNode = {
    id: 'node-puppeteer',
    name: 'Puppeteer Browser',
    type: 'n8n-nodes-puppeteer.puppeteer',
    version: 1,
    position: positionFor(index),
    role: 'main',
    communityPackage: communityPackageFor('n8n-nodes-puppeteer.puppeteer'),
    config: {
      operation: 'getPage',
      url: '={{ $json.url }}',
      options: {
        timeout: 30000,
        waitUntil: 'networkidle0',
      },
    },
  };

  if (!enabled) {
    node.config = { note: 'Community node disabled. Install n8n-nodes-puppeteer or replace this node.' };
  }

  return node;
}

function createChatwootNode(index: number, enabled: boolean): WorkflowNode {
  const node: WorkflowNode = withCredentials({
    id: 'node-chatwoot',
    name: 'Chatwoot Integration',
    type: '@devlikeapro/n8n-nodes-chatwoot.chatwoot',
    version: 1,
    position: positionFor(index),
    role: 'main',
    communityPackage: communityPackageFor('@devlikeapro/n8n-nodes-chatwoot.chatwoot'),
    config: {
      resource: 'message',
      operation: 'create',
      inboxId: '={{ $json.inboxId }}',
      conversationId: '={{ $json.conversationId }}',
      messageType: 'outgoing',
      content: '={{ $json.message || $json.text }}',
    },
  });

  if (!enabled) {
    node.config = { note: 'Community node disabled. Install @devlikeapro/n8n-nodes-chatwoot or replace this node.' };
  }

  return node;
}

function createPalatineSpeechNode(index: number, enabled: boolean): WorkflowNode {
  const node: WorkflowNode = withCredentials({
    id: 'node-palatinespeech',
    name: 'Palatine Speech Transcription',
    type: 'n8n-nodes-palatine-speech.palatinespeech',
    version: 1,
    position: positionFor(index),
    role: 'main',
    communityPackage: communityPackageFor('n8n-nodes-palatine-speech.palatinespeech'),
    config: {
      operation: 'transcribe',
      binaryPropertyName: 'data',
      diarization: true,
      language: 'ru',
    },
  });

  if (!enabled) {
    node.config = { note: 'Community node disabled. Install n8n-nodes-palatine-speech or replace this node.' };
  }

  return node;
}

function createGlobalsNode(index: number, enabled: boolean): WorkflowNode {
  const node: WorkflowNode = {
    id: 'node-globals',
    name: 'Globals Constants',
    type: 'n8n-nodes-globals.globals',
    version: 1,
    position: positionFor(index),
    role: 'main',
    communityPackage: communityPackageFor('n8n-nodes-globals.globals'),
    config: {
      variables: [
        {
          key: 'api_base_url',
          value: 'https://api.example.com',
        },
      ],
    },
  };

  if (!enabled) {
    node.config = { note: 'Community node disabled. Install n8n-nodes-globals or replace this node.' };
  }

  return node;
}

function createTesseractNode(index: number, enabled: boolean): WorkflowNode {
  const node: WorkflowNode = {
    id: 'node-tesseractjs',
    name: 'Tesseract OCR',
    type: 'n8n-nodes-tesseractjs.tesseractjs',
    version: 1,
    position: positionFor(index),
    role: 'main',
    communityPackage: communityPackageFor('n8n-nodes-tesseractjs.tesseractjs'),
    config: {
      binaryPropertyName: 'data',
      language: 'rus+eng',
    },
  };

  if (!enabled) {
    node.config = { note: 'Community node disabled. Install n8n-nodes-tesseractjs or replace this node.' };
  }

  return node;
}

function createElevenLabsNode(index: number, enabled: boolean): WorkflowNode {
  const node: WorkflowNode = withCredentials({
    id: 'node-elevenlabs',
    name: 'ElevenLabs Speech',
    type: '@elevenlabs/n8n-nodes-elevenlabs.elevenLabs',
    version: 1,
    position: positionFor(index),
    role: 'main',
    communityPackage: communityPackageFor('@elevenlabs/n8n-nodes-elevenlabs.elevenLabs'),
    config: {
      operation: 'textToSpeech',
      text: '={{ $json.text || $json.message }}',
      voiceId: '21m00Tcm4TlvDq8ikWAM',
    },
  });

  if (!enabled) {
    node.config = { note: 'Community node disabled. Install @elevenlabs/n8n-nodes-elevenlabs or replace this node.' };
  }

  return node;
}

function createTavilyNode(index: number, enabled: boolean): WorkflowNode {
  const node: WorkflowNode = withCredentials({
    id: 'node-tavily',
    name: 'Tavily Search',
    type: '@tavily/n8n-nodes-tavily.tavily',
    version: 1,
    position: positionFor(index),
    role: 'main',
    communityPackage: communityPackageFor('@tavily/n8n-nodes-tavily.tavily'),
    config: {
      query: '={{ $json.query || $json.text }}',
      searchDepth: 'advanced',
    },
  });

  if (!enabled) {
    node.config = { note: 'Community node disabled. Install @tavily/n8n-nodes-tavily or replace this node.' };
  }

  return node;
}

function createHtmlCssToPdfNode(index: number, enabled: boolean): WorkflowNode {
  const node: WorkflowNode = withCredentials({
    id: 'node-htmlcsstopdf',
    name: 'HTML to PDF Converter',
    type: 'n8n-nodes-htmlcsstopdf.htmlcsstopdf',
    version: 1,
    position: positionFor(index),
    role: 'main',
    communityPackage: communityPackageFor('n8n-nodes-htmlcsstopdf.htmlcsstopdf'),
    config: {
      html: '={{ $json.html || $json.body }}',
    },
  });

  if (!enabled) {
    node.config = { note: 'Community node disabled. Install n8n-nodes-htmlcsstopdf or replace this node.' };
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
    communityPackage: communityPackageFor('@n8n/n8n-nodes-langchain.vectorStoreQdrant'),
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

function createEmailSendNode(index: number): WorkflowNode {
  return withCredentials({
    id: 'node-email-send',
    name: 'Send Email',
    type: 'n8n-nodes-base.emailSend',
    version: 2.1,
    position: positionFor(index),
    role: 'main',
    config: {
      fromEmail: 'info@example.com',
      toEmail: '={{ $json.email }}',
      subject: '={{ $json.subject || "n8n automation update" }}',
      html: true,
      emailFormat: 'html',
      message: '={{ $json.body || $json.summary }}',
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

function createFilterNode(index: number): WorkflowNode {
  return {
    id: 'node-filter',
    name: 'Filter Items',
    type: 'n8n-nodes-base.filter',
    version: 2,
    position: positionFor(index),
    role: 'main',
    config: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          {
            id: 'condition-filter',
            leftValue: '={{ $json.active }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  };
}

function createSortNode(index: number): WorkflowNode {
  return {
    id: 'node-sort',
    name: 'Sort Items',
    type: 'n8n-nodes-base.sort',
    version: 1,
    position: positionFor(index),
    role: 'main',
    config: {
      sortFields: {
        sortFields: [
          {
            fieldName: 'id',
            order: 'ascending',
          },
        ],
      },
    },
  };
}

function createLimitNode(index: number): WorkflowNode {
  return {
    id: 'node-limit',
    name: 'Limit Items',
    type: 'n8n-nodes-base.limit',
    version: 1,
    position: positionFor(index),
    role: 'main',
    config: {
      maxItems: 10,
    },
  };
}

function createRemoveDuplicatesNode(index: number): WorkflowNode {
  return {
    id: 'node-remove-duplicates',
    name: 'Remove Duplicates',
    type: 'n8n-nodes-base.removeDuplicates',
    version: 1,
    position: positionFor(index),
    role: 'main',
    config: {
      compare: 'selectedFields',
      fieldsToCompare: {
        fields: [
          {
            fieldName: 'id',
          },
        ],
      },
    },
  };
}

function createSplitOutNode(index: number): WorkflowNode {
  return {
    id: 'node-split-out',
    name: 'Split Out Items',
    type: 'n8n-nodes-base.splitOut',
    version: 1,
    position: positionFor(index),
    role: 'main',
    config: {
      fieldToSplitOut: 'items',
      options: {},
    },
  };
}

function createAggregateNode(index: number): WorkflowNode {
  return {
    id: 'node-aggregate',
    name: 'Aggregate Items',
    type: 'n8n-nodes-base.aggregate',
    version: 1,
    position: positionFor(index),
    role: 'main',
    config: {
      aggregateAs: 'list',
      fieldsToAggregate: {
        fieldToAggregate: [
          {
            fieldToAggregate: 'id',
            renameField: false,
          },
        ],
      },
    },
  };
}

function createSummarizeNode(index: number): WorkflowNode {
  return {
    id: 'node-summarize',
    name: 'Summarize Items',
    type: 'n8n-nodes-base.summarize',
    version: 1,
    position: positionFor(index),
    role: 'main',
    config: {
      fieldsToSummarize: {
        columns: [
          {
            aggregation: 'sum',
            field: 'price',
            renameField: false,
          },
        ],
      },
    },
  };
}

function createMergeNode(index: number): WorkflowNode {
  return {
    id: 'node-merge',
    name: 'Merge Streams',
    type: 'n8n-nodes-base.merge',
    version: 3,
    position: positionFor(index),
    role: 'main',
    config: {
      mode: 'combine',
      combinationMode: 'mergeByPosition',
    },
  };
}

function createCompareDatasetsNode(index: number): WorkflowNode {
  return {
    id: 'node-compare-datasets',
    name: 'Compare Datasets',
    type: 'n8n-nodes-base.compareDatasets',
    version: 1,
    position: positionFor(index),
    role: 'main',
    config: {
      mergeKey: 'id',
    },
  };
}

function createRenameKeysNode(index: number): WorkflowNode {
  return {
    id: 'node-rename-keys',
    name: 'Rename Keys',
    type: 'n8n-nodes-base.renameKeys',
    version: 1,
    position: positionFor(index),
    role: 'main',
    config: {
      keys: {
        key: [
          {
            currentKey: 'oldKey',
            newKey: 'newKey',
          },
        ],
      },
    },
  };
}

function createSwitchNode(index: number): WorkflowNode {
  return {
    id: 'node-switch',
    name: 'Switch Routing',
    type: 'n8n-nodes-base.switch',
    version: 2,
    position: positionFor(index),
    role: 'main',
    config: {
      dataType: 'string',
      rules: {
        rules: [
          {
            value: 'paid',
            output: 0,
          },
          {
            value: 'pending',
            output: 1,
          },
        ],
      },
    },
  };
}

function createCodeNode(index: number, language: 'js' | 'python' = 'js'): WorkflowNode {
  return {
    id: 'node-code',
    name: 'Run Custom Script',
    type: 'n8n-nodes-base.code',
    version: 2,
    position: positionFor(index),
    role: 'main',
    config: {
      language: language === 'python' ? 'python' : 'javascript',
      jsCode: '// Write your custom logic here\nreturn items;',
      pythonCode: '# Write your custom logic here\nreturn items',
    },
  };
}

function shouldAllowCodeNode(task: string): boolean {
  const intents = detectIntents(task);
  const forbiddenIntents: IntentId[] = [
    'filter',
    'if',
    'switch',
    'sort',
    'limit',
    'removeDuplicates',
    'splitOut',
    'aggregate',
    'summarize',
    'merge',
    'compareDatasets',
    'renameKeys',
  ];

  const hasForbiddenIntent = forbiddenIntents.some((intent) => intents.has(intent));
  if (hasForbiddenIntent) {
    return false;
  }

  return true;
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
    code += `,\n        credentials: ${formatObject(workflowNode.credentials, 8)}`;
  }
  if (workflowNode.settings) {
    if (workflowNode.settings.continueOnFail) {
      code += `,\n        onError: 'continueRegularOutput'`;
    }
    if (workflowNode.settings.retryOnFail) {
      code += `,\n        retryOnFail: true`;
    }
    if (workflowNode.settings.maxTries !== undefined) {
      code += `,\n        maxTries: ${workflowNode.settings.maxTries}`;
    }
    if (workflowNode.settings.waitBetweenTries !== undefined) {
      code += `,\n        waitBetweenTries: ${workflowNode.settings.waitBetweenTries}`;
    }
  }
  code += `\n    })\n`;
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
    .replace(/\\\\n/g, '\\n')
    .replace(/\\\\r/g, '\\r')
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

function addStickyNotes(nodes: WorkflowNode[], description: string, workflowName: string): void {
  const triggerNode = nodes.find((n) => n.id === 'node-trigger');
  const triggerName = triggerNode ? triggerNode.name : 'Unknown Trigger';
  
  const hasAiNodes = nodes.some((n) => n.type.includes('nodes-langchain') || n.type.includes('agent'));
  
  const overviewContent = [
    `![n8n workflow](https://img.shields.io/badge/n8n-workflow_designer-EA4AAA#full-width)`,
    ``,
    `# 📋 Workflow Overview`,
    `**Name:** ${workflowName}`,
    ``,
    `### 💡 Description`,
    `${description}`,
    ``,
    `### 🚀 Trigger`,
    `Starts automatically via **${triggerName}**.`,
  ];

  if (hasAiNodes) {
    overviewContent.push(
      ``,
      `### 📺 AI Tutorial Video`,
      `@[youtube](ZCuL2e4zC_4)`
    );
  }

  overviewContent.push(
    ``,
    `---`,
    `*Designed automatically by Antigravity.*`
  );

  const overviewHeight = hasAiNodes ? 480 : 300;

  nodes.push({
    id: 'note-workflow-overview',
    name: 'Workflow Overview Note',
    type: 'n8n-nodes-base.stickyNote',
    version: 1,
    position: [-180, 120],
    role: 'note',
    config: {
      content: overviewContent.join('\n'),
      height: overviewHeight,
      width: 340,
      color: '#f9f0ff', // Soft Lavender
    },
  });

  // Add backdrop container behind AI Agent and its subnodes if present
  const agentNode = nodes.find((n) => n.type === '@n8n/n8n-nodes-langchain.agent');
  if (agentNode) {
    const hasQdrant = nodes.some((n) => n.type.includes('vectorStoreQdrant'));
    const backdropWidth = hasQdrant ? 600 : 380;
    const backdropHeight = 340;
    const agentX = agentNode.position[0];
    
    nodes.push({
      id: 'note-ai-backdrop',
      name: 'AI Agent Container Backdrop',
      type: 'n8n-nodes-base.stickyNote',
      version: 1,
      position: [agentX - 40, 280],
      role: 'note',
      config: {
        content: [
          `# 🧠 AI Brain Core`,
          `*This container groups the AI Agent executor with its language model and memory context.*`
        ].join('\n'),
        height: backdropHeight,
        width: backdropWidth,
        color: '#f6ffed', // Soft Mint Green
      },
    });
  }

  const mainNodes = nodes.filter((n) => n.role === 'main');
  for (const node of mainNodes) {
    const purpose = getNodePurpose(node);
    const customConfig = getNodeCustomConfig(node);
    
    const settingsList: string[] = [];
    if (node.settings?.continueOnFail) {
      settingsList.push(`- ⚠️ *Ignores errors (Continue on Fail)*`);
    }
    if (node.settings?.retryOnFail) {
      settingsList.push(`- 🔄 *Retries on error (${node.settings.maxTries}x, wait ${node.settings.waitBetweenTries ? node.settings.waitBetweenTries / 1000 : 5}s)*`);
    }
    
    const settingsSection = settingsList.length > 0 
      ? `\n**⚙️ Error Handling:**\n${settingsList.join('\n')}`
      : '';

    const content = [
      `### 📦 ${node.name}`,
      `*Type:* \`${node.type.split('.').pop()}\``,
      ``,
      `**Purpose:**`,
      purpose,
      ``,
      `🔧 **Config to Customize:**`,
      customConfig,
      settingsSection
    ].join('\n');

    const color = getNodeColor(node);

    nodes.push({
      id: `note-${node.id}`,
      name: `Note: ${node.name}`,
      type: 'n8n-nodes-base.stickyNote',
      version: 1,
      position: [node.position[0], 120],
      role: 'note',
      config: {
        content,
        height: 150,
        width: 240,
        color,
      },
    });
  }
}

function getNodePurpose(node: WorkflowNode): string {
  const type = node.type;
  if (type.includes('scheduleTrigger')) return 'Triggers the workflow at set intervals (e.g., daily, hourly).';
  if (type.includes('telegramTrigger')) return 'Listens for incoming messages or updates from a Telegram bot.';
  if (type.includes('microsoftOutlookTrigger')) return 'Triggers when a new email is received in Outlook.';
  if (type.includes('chatTrigger')) return 'Provides a chat interface for triggering the workflow manually.';
  if (type.includes('manualTrigger')) return 'Allows manual execution of the workflow from the n8n UI.';
  if (type.includes('webhook')) return 'Exposes a URL endpoint to trigger the workflow via HTTP POST/GET.';
  if (type.includes('set')) return 'Renames, maps, formats, and prepares data fields for downstream nodes.';
  if (type.includes('bitrix24')) return 'Performs actions inside Bitrix24 (e.g., creating a lead or deal).';
  if (type.includes('docxtemplater')) return 'Fills a Word DOCX template with dynamic data fields.';
  if (type.includes('agent')) return 'AI Agent that orchestrates language model requests with tools & memory.';
  if (type.includes('googleSheets')) return 'Appends, updates, or retrieves rows in a Google Sheet.';
  if (type.includes('googleDrive')) return 'Uploads files, creates folders, or manages Google Drive assets.';
  if (type.includes('microsoftOutlook')) return 'Sends outbound emails or updates calendar events via Outlook.';
  if (type.includes('microsoftTeams')) return 'Sends notifications and chat messages to MS Teams channels.';
  if (type.includes('telegram')) return 'Sends alert messages to a Telegram chat or channel.';
  if (type.includes('if')) return 'Validates inputs and splits the execution path based on conditions.';
  if (type.includes('filter')) return 'Filters items in the list based on specific conditions.';
  if (type.includes('removeDuplicates')) return 'Removes duplicate items from the list based on specific fields.';
  if (type.includes('sort')) return 'Sorts items in the list based on specific fields and direction.';
  if (type.includes('splitOut')) return 'Splits a nested array within each item into separate items.';
  if (type.includes('aggregate')) return 'Aggregates fields from multiple items into a single list or object.';
  if (type.includes('summarize')) return 'Calculates sum, average, count, min, or max across multiple items.';
  if (type.includes('limit')) return 'Limits the number of items that pass through to the next nodes.';
  if (type.includes('merge')) return 'Merges data streams from different inputs together.';
  if (type.includes('compareDatasets')) return 'Compares two datasets to find new, updated, or deleted items.';
  if (type.includes('renameKeys')) return 'Renames fields/keys in the input data.';
  if (type.includes('switch')) return 'Routes items to different branches based on rules.';
  if (type.includes('code')) return 'Executes custom JavaScript or Python code for advanced logic.';
  return 'Performs integration or data transformation in the workflow.';
}

function getNodeCustomConfig(node: WorkflowNode): string {
  const type = node.type;
  if (type.includes('Trigger') || type.includes('webhook')) {
    return 'Configure execution schedules or webhook pathways.';
  }
  if (type.includes('set')) {
    return 'Adjust field mappings or add/remove variables.';
  }
  if (type.includes('bitrix24')) {
    return 'Connect credentials and map CRM lead/deal fields.';
  }
  if (type.includes('docxtemplater')) {
    return 'Provide input binary key and set output file name.';
  }
  if (type.includes('agent')) {
    return 'Refine system prompt and connect tools/memory.';
  }
  if (type.includes('googleSheets')) {
    return 'Set Document ID and worksheet name parameters.';
  }
  if (type.includes('googleDrive')) {
    return 'Set parent folder ID and select upload file binary.';
  }
  if (type.includes('microsoftOutlook')) {
    return 'Set recipient email address, subject, and body template.';
  }
  if (type.includes('microsoftTeams') || type.includes('telegram')) {
    return 'Specify the target Channel/Chat ID or webhook URL.';
  }
  if (type.includes('if')) {
    return 'Define the conditions to validate input data.';
  }
  if (type.includes('filter')) {
    return 'Set the filtering conditions to match.';
  }
  if (type.includes('removeDuplicates')) {
    return 'Select fields to compare for finding duplicates.';
  }
  if (type.includes('sort')) {
    return 'Define sorting fields and ascending/descending order.';
  }
  if (type.includes('splitOut')) {
    return 'Specify the name of the nested array field to split out.';
  }
  if (type.includes('aggregate')) {
    return 'Choose the fields to aggregate and the output format.';
  }
  if (type.includes('summarize')) {
    return 'Select fields and aggregation operations (e.g., sum, count).';
  }
  if (type.includes('limit')) {
    return 'Specify the maximum number of items allowed to pass.';
  }
  if (type.includes('merge')) {
    return 'Configure the merge mode (e.g., Merge by Key, Multiplex).';
  }
  if (type.includes('compareDatasets')) {
    return 'Select the unique key to match items between datasets.';
  }
  if (type.includes('renameKeys')) {
    return 'Define the keys mapping (old names to new names).';
  }
  if (type.includes('switch')) {
    return 'Define routing rules and values for different branches.';
  }
  if (type.includes('code')) {
    return 'Write custom JS/Python script and configure data input/output.';
  }
  return 'Provide API parameters and connect credentials.';
}

function getNodeColor(node: WorkflowNode): string {
  const type = node.type;
  if (type.includes('Trigger') || type.includes('webhook')) {
    return '#fff7e6'; // Pastel Yellow
  }
  if (
    type.includes('set') ||
    type.includes('if') ||
    type.includes('filter') ||
    type.includes('removeDuplicates') ||
    type.includes('sort') ||
    type.includes('splitOut') ||
    type.includes('aggregate') ||
    type.includes('summarize') ||
    type.includes('limit') ||
    type.includes('merge') ||
    type.includes('compareDatasets') ||
    type.includes('renameKeys') ||
    type.includes('switch')
  ) {
    return '#f5f5f5'; // Sleek Light Gray
  }
  if (type.includes('agent') || type.includes('nodes-langchain')) {
    return '#f6ffed'; // Soft Mint Green
  }
  if (type.includes('code')) {
    return '#fff0f6'; // Soft Pink/Rose for Code nodes (indicates escape hatch/caution)
  }
  return '#e6f7ff'; // Clean Ice Blue
}
