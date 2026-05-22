export type IntentId =
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
  priority: number;
  conflictGroup?: IntentConflictGroup;
  exactPhrases?: readonly string[];
  strongPhrases?: readonly string[];
  tokens?: readonly string[];
  coOccurrences?: readonly (readonly string[])[];
  weakTokens?: readonly string[];
  negativeSignals?: readonly string[];
}

export interface NodeCandidate {
  intent: IntentId;
  nodeType: string;
  confidence: number;
  priority: number;
  matchedSignals: readonly string[];
  supportingSignals: readonly string[];
  conflictGroup?: IntentConflictGroup;
  reason: string;
}

export const HIGH_CONFIDENCE_THRESHOLD = 0.75;
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.6;

const INTENT_RULES: readonly IntentRule[] = [
  {
    intent: 'filter',
    nodeType: 'n8n-nodes-base.filter',
    priority: 90,
    conflictGroup: 'conditional',
    exactPhrases: ['оставить только', 'filter active', 'filter paid'],
    strongPhrases: ['filter', 'фильтр', 'отфильтровать', 'исключить', 'отсеять'],
    tokens: ['only', 'active', 'paid', 'оплаченные'],
  },
  {
    intent: 'if',
    nodeType: 'n8n-nodes-base.if',
    priority: 80,
    conflictGroup: 'conditional',
    exactPhrases: ['if status is', 'если статус'],
    strongPhrases: ['if', 'если', 'validate', 'check', 'проверить', 'валидация', 'проверка'],
    tokens: ['condition', 'boolean', 'status', 'статус'],
    negativeSignals: ['filter', 'оставить только'],
  },
  {
    intent: 'switch',
    nodeType: 'n8n-nodes-base.switch',
    priority: 95,
    conflictGroup: 'conditional',
    exactPhrases: ['route by', 'branch by', 'different paths', 'в зависимости от'],
    strongPhrases: ['switch', 'маршрутизировать', 'ветки', 'branching', 'route', 'routing', 'rules'],
    tokens: ['status', 'статус', 'paid', 'expired', 'error', 'pending', 'success', 'approved', 'rejected', 'разделить по', 'ветвление'],
    coOccurrences: [
      ['status', 'paid'], ['status', 'expired'], ['status', 'error'], ['status', 'pending'], ['status', 'success'],
      ['статус', 'paid'], ['статус', 'expired'], ['статус', 'error'], ['статус', 'pending'], ['статус', 'success'],
    ],
  },
  {
    intent: 'sort',
    nodeType: 'n8n-nodes-base.sort',
    priority: 84,
    conflictGroup: 'ordering',
    exactPhrases: ['order by', 'sort orders', 'sort the records', 'отсортировать по'],
    strongPhrases: ['sort', 'сортиров', 'отсортировать', 'упорядочить'],
    tokens: ['by date', 'по дате', 'by name', 'по имени'],
    coOccurrences: [['compare', 'price', 'best'], ['compare', 'cost', 'cheapest'], ['сравнить', 'цен', 'лучший']],
  },
  {
    intent: 'limit',
    nodeType: 'n8n-nodes-base.limit',
    priority: 70,
    conflictGroup: 'ordering',
    exactPhrases: ['limit the outputs', 'first 5', 'первые 10'],
    strongPhrases: ['limit', 'лимит', 'first', 'top', 'первые', 'последние', 'ограничить количество'],
    tokens: ['last', 'items'],
  },
  {
    intent: 'removeDuplicates',
    nodeType: 'n8n-nodes-base.removeDuplicates',
    priority: 90,
    conflictGroup: 'collection',
    exactPhrases: ['remove duplicates', 'убрать дубликаты', 'очистить от дублей'],
    strongPhrases: ['dedupe', 'de-duplicate', 'дубликат', 'уникальн', 'убрать дубли'],
    tokens: ['unique', 'by email', 'по email'],
  },
  {
    intent: 'splitOut',
    nodeType: 'n8n-nodes-base.splitOut',
    priority: 88,
    conflictGroup: 'collection',
    exactPhrases: ['split out', 'split array', 'разбить массив', 'for each item', 'каждый элемент массива'],
    strongPhrases: ['разбить список', 'цикл по элементам'],
    coOccurrences: [['split', 'array'], ['split', 'items'], ['разбить', 'массив'], ['разбить', 'товары']],
    tokens: ['array', 'list', 'items', 'elements', 'товары', 'заказы', 'rows', 'строки таблицы'],
    negativeSignals: ['задачу', 'этапы', 'task', 'steps'],
  },
  {
    intent: 'aggregate',
    nodeType: 'n8n-nodes-base.aggregate',
    priority: 76,
    conflictGroup: 'collection',
    exactPhrases: ['собрать в список', 'collect to list', 'combine into array', 'group to list'],
    strongPhrases: ['aggregate', 'агрегировать', 'группировать в список'],
    coOccurrences: [['combine', 'text'], ['join', 'string'], ['объединить', 'строки']],
    tokens: ['into one string', 'в одну строку', 'messages', 'сообщения'],
    negativeSignals: ['sum all', 'total amount', 'посчитать сумму'],
  },
  {
    intent: 'summarize',
    nodeType: 'n8n-nodes-base.summarize',
    priority: 84,
    conflictGroup: 'collection',
    exactPhrases: ['sum all', 'total sum', 'total amount', 'посчитать сумму'],
    strongPhrases: ['summarize', 'сумм', 'средн', 'average', 'mean'],
    coOccurrences: [['calculate', 'total'], ['count', 'orders'], ['посчитать', 'заказов']],
    tokens: ['count', 'общее'],
    negativeSignals: ['per item', 'each', 'для каждого', 'каждого', 'комисси', 'налог', 'скидк'],
  },
  {
    intent: 'merge',
    nodeType: 'n8n-nodes-base.merge',
    priority: 78,
    conflictGroup: 'combination',
    exactPhrases: ['merge streams', 'join streams', 'объединить потоки', 'соединить данные'],
    strongPhrases: ['merge'],
    coOccurrences: [['combine', 'streams'], ['join', 'tables'], ['объединить', 'данные']],
    tokens: ['streams', 'branches', 'sources', 'tables', 'потоки', 'ветки', 'источники'],
  },
  {
    intent: 'compareDatasets',
    nodeType: 'n8n-nodes-base.compareDatasets',
    priority: 82,
    conflictGroup: 'combination',
    exactPhrases: ['compare datasets', 'find changes', 'сравнить данные', 'сравнить таблицы'],
    strongPhrases: ['diff', 'найти изменения'],
    coOccurrences: [['compare', 'datasets'], ['compare', 'tables'], ['сравнить', 'таблиц'], ['сравнить', 'данные']],
    tokens: ['datasets', 'lists', 'tables', 'данные', 'списк'],
    negativeSignals: ['best', 'cheapest', 'лучший', 'цены', 'price'],
  },
  {
    intent: 'renameKeys',
    nodeType: 'n8n-nodes-base.renameKeys',
    priority: 74,
    conflictGroup: 'field-operation',
    exactPhrases: ['rename keys', 'rename fields', 'переименовать поля', 'поменять названия полей'],
    strongPhrases: ['rename'],
    tokens: ['field names', 'keys'],
  },
];

export function detectNodeCandidates(description: string): NodeCandidate[] {
  const lower = description.toLowerCase();

  return INTENT_RULES.map((rule) => scoreRule(rule, lower))
    .filter((candidate): candidate is NodeCandidate => Boolean(candidate))
    .sort((a, b) => b.confidence - a.confidence || b.priority - a.priority);
}

export function resolveConflicts(candidates: readonly NodeCandidate[]): NodeCandidate[] {
  const grouped = new Map<IntentConflictGroup, NodeCandidate[]>();
  const selected: NodeCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
      selected.push(candidate);
      continue;
    }

    if (candidate.confidence < MEDIUM_CONFIDENCE_THRESHOLD) {
      continue;
    }

    if (!candidate.conflictGroup) {
      selected.push(candidate);
      continue;
    }

    const group = grouped.get(candidate.conflictGroup) || [];
    group.push(candidate);
    grouped.set(candidate.conflictGroup, group);
  }

  for (const group of grouped.values()) {
    group.sort((a, b) => b.confidence - a.confidence || b.priority - a.priority);
    selected.push(group[0]);
  }

  return dedupeCandidates(selected).sort((a, b) => b.priority - a.priority);
}

export function detectSelectedIntents(description: string): Set<IntentId> {
  return new Set(resolveConflicts(detectNodeCandidates(description)).map((candidate) => candidate.intent));
}

export function shouldAllowCodeNode(task: string): boolean {
  return !resolveConflicts(detectNodeCandidates(task)).some(
    (candidate) => candidate.confidence >= HIGH_CONFIDENCE_THRESHOLD,
  );
}

function scoreRule(rule: IntentRule, lower: string): NodeCandidate | undefined {
  const matchedSignals: string[] = [];
  const supportingSignals: string[] = [];
  let confidence = 0;

  for (const phrase of rule.exactPhrases || []) {
    if (hasPhrase(lower, phrase)) {
      matchedSignals.push(phrase);
      confidence = Math.max(confidence, 0.92);
    }
  }

  for (const phrase of rule.strongPhrases || []) {
    if (hasPhrase(lower, phrase)) {
      matchedSignals.push(phrase);
      confidence = Math.max(confidence, 0.82);
    }
  }

  for (const coOccurrence of rule.coOccurrences || []) {
    if (coOccurrence.every((signal) => hasPhrase(lower, signal))) {
      matchedSignals.push(coOccurrence.join('+'));
      confidence = Math.max(confidence, 0.7);
    }
  }

  for (const token of rule.tokens || []) {
    if (hasPhrase(lower, token)) {
      supportingSignals.push(token);
      confidence = Math.max(confidence, 0.42);
    }
  }

  for (const token of rule.weakTokens || []) {
    if (hasPhrase(lower, token)) {
      supportingSignals.push(token);
      confidence = Math.max(confidence, 0.3);
    }
  }

  if (confidence === 0) {
    return undefined;
  }

  confidence += Math.min(supportingSignals.length * 0.04, 0.16);
  confidence += Math.min(Math.max(matchedSignals.length - 1, 0) * 0.03, 0.08);

  const negativeMatches = (rule.negativeSignals || []).filter((signal) => hasPhrase(lower, signal));
  confidence -= Math.min(negativeMatches.length * 0.28, 0.56);
  confidence = Math.max(0, Math.min(0.98, confidence));

  if (confidence < MEDIUM_CONFIDENCE_THRESHOLD) {
    return undefined;
  }

  return {
    intent: rule.intent,
    nodeType: rule.nodeType,
    confidence,
    priority: rule.priority,
    matchedSignals,
    supportingSignals,
    conflictGroup: rule.conflictGroup,
    reason: `${rule.intent} matched ${matchedSignals.join(', ') || supportingSignals.join(', ')} at ${confidence.toFixed(2)}`,
  };
}

function dedupeCandidates(candidates: readonly NodeCandidate[]): NodeCandidate[] {
  const byIntent = new Map<IntentId, NodeCandidate>();
  for (const candidate of candidates) {
    const existing = byIntent.get(candidate.intent);
    if (!existing || candidate.confidence > existing.confidence || (candidate.confidence === existing.confidence && candidate.priority > existing.priority)) {
      byIntent.set(candidate.intent, candidate);
    }
  }
  return [...byIntent.values()];
}

function hasPhrase(lower: string, phrase: string): boolean {
  if (/^[a-z0-9_-]+$/i.test(phrase)) {
    return new RegExp(`(^|[^a-z0-9_-])${escapeRegExp(phrase)}([^a-z0-9_-]|$)`, 'i').test(lower);
  }
  return lower.includes(phrase.toLowerCase());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
