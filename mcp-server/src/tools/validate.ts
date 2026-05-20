import {
  validateWorkflow as validateSdkWorkflow,
  type NodeJSON,
  type WorkflowJSON,
  type ValidationResult as SdkValidationResult,
} from '@n8n/workflow-sdk';
import {
  communityInstallHintFor,
  communityPackageFor,
  credentialRequirementsFor,
  NODE_REGISTRY,
  validateNodeAgainstRegistry,
} from './node-registry.js';
import { compileWorkflow } from './compile.js';

export interface ValidateWorkflowArgs {
  typescriptCode?: string;
  workflowJson?: Partial<WorkflowJSON> & { nodes?: Array<Partial<NodeJSON>> };
  schemaValidation?: 'off' | 'known-node-registry';
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  node?: string;
  recommendation: string;
}

export interface ValidationResult {
  valid: boolean;
  score: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
  summary: string;
}

const NATIVE_ALTERNATIVES: Array<{ pattern: RegExp; nativeType: string; label: string }> = [
  { pattern: /bitrix|crm\.lead|crm\.deal/i, nativeType: 'n8n-nodes-base.bitrix24', label: 'Bitrix24' },
  { pattern: /teams|microsoft graph.*team/i, nativeType: 'n8n-nodes-base.microsoftTeams', label: 'Microsoft Teams' },
  { pattern: /telegram|sendMessage/i, nativeType: 'n8n-nodes-base.telegram', label: 'Telegram' },
  { pattern: /outlook|office365|sendmail|messageReceived/i, nativeType: 'n8n-nodes-base.microsoftOutlook', label: 'Microsoft Outlook' },
  { pattern: /google.*sheet|spreadsheets/i, nativeType: 'n8n-nodes-base.googleSheets', label: 'Google Sheets' },
  { pattern: /google.*drive|drive\.google/i, nativeType: 'n8n-nodes-base.googleDrive', label: 'Google Drive' },
  { pattern: /openai|openrouter|chat\/completions|llm|gpt/i, nativeType: '@n8n/n8n-nodes-langchain.agent', label: 'AI Agent + chat model sub-node' },
  { pattern: /slack/i, nativeType: 'n8n-nodes-base.slack', label: 'Slack' },
];

const DEPRECATED_COMMUNITY_PACKAGES: Array<{
  pattern: RegExp;
  recommendation: string;
  severity: 'warning' | 'error';
  message: string;
}> = [
  {
    pattern: /n8n-nodes-evolution-api|n8n-nodes-waha|n8n-nodes-zapi/i,
    severity: 'warning',
    message: 'Uses WhatsApp Web automation which has a high account ban risk.',
    recommendation: 'Use official WhatsApp Business Cloud API node or official green-zone integrations instead.',
  },
  {
    pattern: /n8n-nodes-chatwoot(?!.*@devlikeapro)/i,
    severity: 'warning',
    message: 'Outdated unscoped n8n-nodes-chatwoot package (not updated for 3 years).',
    recommendation: 'Use the official green-zone `@devlikeapro/n8n-nodes-chatwoot` package instead.',
  },
  {
    pattern: /n8n-nodes-firecrawl(?!.*@mendable)/i,
    severity: 'warning',
    message: 'Outdated unscoped n8n-nodes-firecrawl package (not updated for over a year).',
    recommendation: 'Use the official green-zone `@mendable/n8n-nodes-firecrawl` package instead.',
  },
  {
    pattern: /n8n-nodes-elevenlabs(?!.*@elevenlabs)/i,
    severity: 'warning',
    message: 'Outdated unscoped n8n-nodes-elevenlabs package (not updated for over a year).',
    recommendation: 'Use the official green-zone `@elevenlabs/n8n-nodes-elevenlabs` package instead.',
  },
  {
    pattern: /n8n-nodes-tavily(?!.*@tavily)/i,
    severity: 'warning',
    message: 'Outdated unscoped n8n-nodes-tavily package (not updated for over a year).',
    recommendation: 'Use the official green-zone `@tavily/n8n-nodes-tavily` package instead.',
  },
  {
    pattern: /n8n-nodes-apify(?!.*@apify)/i,
    severity: 'warning',
    message: 'Outdated unscoped n8n-nodes-apify package (not updated for over a year).',
    recommendation: 'Use the official green-zone `@apify/n8n-nodes-apify` package instead.',
  },
  {
    pattern: /n8n-nodes-kommo|n8n-nodes-datadog|n8n-nodes-difyai|n8n-nodes-soaprequest|n8n-nodes-avisaapi/i,
    severity: 'warning',
    message: 'This community package has not been updated for over a year and may cause compatibility issues.',
    recommendation: 'Consider writing a custom JS script in a Code node or using native HTTP Request nodes.',
  },
];

export async function validateWorkflow(args: ValidateWorkflowArgs): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  if (!args.typescriptCode && !args.workflowJson) {
    issues.push({
      severity: 'error',
      code: 'missing-input',
      message: 'No workflow input provided.',
      recommendation: 'Pass either typescriptCode or workflowJson to validate_workflow.',
    });
    return buildResult(issues);
  }

  let workflowJson = args.workflowJson;

  if (args.typescriptCode) {
    validateTypeScript(args.typescriptCode, issues);
    try {
      workflowJson = await compileWorkflow({ typescriptCode: args.typescriptCode }) as any;
    } catch (e) {
      issues.push({
        severity: 'info',
        code: 'typescript-compilation-failed-for-validation',
        message: 'Could not compile TypeScript to JSON for deep flow checks: ' + (e instanceof Error ? e.message : String(e)),
        recommendation: 'Fix any TypeScript errors in the code so full validation can run.',
      });
    }
  }

  if (workflowJson) {
    validateWithWorkflowSdk(workflowJson, issues);
    validateWorkflowJson(workflowJson, issues, args.schemaValidation || 'known-node-registry');
  }

  return buildResult(issues);
}

function validateTypeScript(code: string, issues: ValidationIssue[]): void {
  validateHttpRequestUsage(code, issues);
  validateErrorWorkflowReference(code, issues);
  validateAiAgentPattern(code, issues);
  validateSetVsCode(code, issues);
  validateCodeFlowControlInTypeScript(code, issues);
  validateCommunityNodes(code, issues);
  validateCredentialReferencesInText(code, issues);
  validateDeprecatedCommunityNodes(code, issues);
  validateDeprecatedNativeNodes(code, issues);
}

function validateWorkflowJson(
  workflow: NonNullable<ValidateWorkflowArgs['workflowJson']>,
  issues: ValidationIssue[],
  schemaValidation: NonNullable<ValidateWorkflowArgs['schemaValidation']>,
): void {
  const nodes = workflow.nodes || [];

  for (const node of nodes) {
    const serialized = JSON.stringify(node);

    if (node.type === 'n8n-nodes-base.httpRequest') {
      addHttpRequestAlternativeIssue(serialized, issues, node.name);
    }

    const settings = (node as any).settings || {};
    if (settings.continueOnFail && settings.retryOnFail) {
      issues.push({
        severity: 'warning',
        code: 'registry-conflicting-error-settings',
        node: node.name,
        message: 'Node has both continueOnFail and retryOnFail settings enabled.',
        recommendation: 'Choose either continueOnFail (to ignore errors and proceed) or retryOnFail (to try again on error), but not both, as they can cause conflicting behavior.',
      });
    }

    if (settings.continueOnFail && !isErrorHandledDownstream(node.name || '', workflow)) {
      issues.push({
        severity: 'warning',
        code: 'registry-unsafe-continue-on-fail',
        node: node.name,
        message: 'continueOnFail is enabled, but the error is not handled or checked downstream.',
        recommendation: 'Add an IF node downstream to check for error (e.g. {{ $json.error }}) to avoid the "green-but-broken" trap where failures go unnoticed.',
      });
    }

    if (node.type) {
      const requiredCredentials = credentialRequirementsFor(node.type);
      const credentialKeys = Object.keys(node.credentials || {});
      const missing = requiredCredentials.filter((key) => !credentialKeys.includes(key));
      if (missing.length > 0) {
        issues.push({
          severity: 'warning',
          code: 'missing-credential-reference',
          node: node.name,
          message: `${node.type} usually requires credential references: ${missing.join(', ')}.`,
          recommendation: 'Add credentials with existing n8n credential id/name placeholders before deployment.',
        });
      }
    }

    if (node.type === 'n8n-nodes-base.code') {
      if (/prepare|format|map|rename|set|transform/i.test(node.name || serialized)) {
        issues.push(createSetNodeIssue(node.name));
      }
      const params = node.parameters || {};
      const jsCode = typeof params.jsCode === 'string' ? params.jsCode : '';
      const pythonCode = typeof params.pythonCode === 'string' ? params.pythonCode : '';
      if (jsCode) {
        checkCodeForFlowControl(jsCode, node.name, issues);
      }
      if (pythonCode) {
        checkCodeForFlowControl(pythonCode, node.name, issues);
      }
    }

    if (node.type && communityPackageFor(node.type)) {
      issues.push({
        severity: 'info',
        code: 'community-node-requirement',
        node: node.name,
        message: `${node.type} is a community or optional node.`,
        recommendation: communityInstallHintFor(node.type) || `Verify ${communityPackageFor(node.type)} is available in the target n8n instance.`,
      });
    }

    if (node.type) {
      for (const rule of DEPRECATED_COMMUNITY_PACKAGES) {
        if (rule.pattern.test(node.type)) {
          issues.push({
            severity: rule.severity,
            code: 'deprecated-community-node',
            node: node.name,
            message: `${node.type}: ${rule.message}`,
            recommendation: rule.recommendation,
          });
        }
      }
    }

    if (node.type === 'n8n-nodes-base.email') {
      issues.push({
        severity: 'warning',
        code: 'deprecated-native-node',
        node: node.name,
        message: 'n8n-nodes-base.email is deprecated and will render as a "?" placeholder in newer n8n instances.',
        recommendation: 'Use n8n-nodes-base.emailSend (for SMTP) or n8n-nodes-base.emailReadImap (for IMAP triggers) instead.',
      });
    }

    if (node.type === 'n8n-nodes-base.start') {
      issues.push({
        severity: 'warning',
        code: 'deprecated-native-node',
        node: node.name,
        message: 'n8n-nodes-base.start is deprecated and removed in newer n8n instances.',
        recommendation: 'Use n8n-nodes-base.manualTrigger instead.',
      });
    }

    if (schemaValidation === 'known-node-registry') {
      for (const registryIssue of validateNodeAgainstRegistry(node)) {
        issues.push({
          severity: registryIssue.code === 'unknown-node-type' ? 'info' : 'warning',
          code: `registry-${registryIssue.code}`,
          node: node.name,
          message: registryIssue.message,
          recommendation: registryIssue.recommendation,
        });
      }
    }
  }

  if (schemaValidation === 'known-node-registry') {
    issues.push({
      severity: 'info',
      code: 'schema-registry-partial',
      message: 'Local schema validation used the known-node registry. Full n8n node schema validation still requires wiring node description directories into @n8n/workflow-sdk.',
      recommendation: 'Use this registry check for early feedback, then validate against a target n8n instance before production deployment.',
    });
  }

  if (!workflow.settings?.errorWorkflow) {
    issues.push(createErrorWorkflowIssue());
  }

  const hasAgent = nodes.some((node) => node.type === '@n8n/n8n-nodes-langchain.agent');
  const hasModel = nodes.some((node) => node.type?.includes('lmChat'));
  if (hasAgent && !hasModel) {
    issues.push(createAiModelIssue());
  }
}

function validateWithWorkflowSdk(workflow: NonNullable<ValidateWorkflowArgs['workflowJson']>, issues: ValidationIssue[]): void {
  if (!isCompleteWorkflowJson(workflow)) {
    issues.push({
      severity: 'info',
      code: 'sdk-validation-skipped',
      message: 'Official @n8n/workflow-sdk validation was skipped because workflow JSON is partial.',
      recommendation: 'Pass compiled workflow JSON with name, nodes, and connections to run SDK validation.',
    });
    return;
  }

  const result: SdkValidationResult = validateSdkWorkflow(workflow, {
    allowDisconnectedNodes: false,
    allowNoTrigger: false,
    validateSchema: false,
  });

  for (const error of result.errors) {
    issues.push({
      severity: 'error',
      code: `sdk-${error.code.toLowerCase()}`,
      node: error.nodeName,
      message: error.message,
      recommendation: 'Fix the workflow structure according to @n8n/workflow-sdk validation before deployment.',
    });
  }

  for (const warning of result.warnings) {
    issues.push({
      severity: 'warning',
      code: `sdk-${warning.code.toLowerCase()}`,
      node: warning.nodeName,
      message: warning.message,
      recommendation: 'Review the official @n8n/workflow-sdk validation warning before deployment.',
    });
  }
}

function isCompleteWorkflowJson(workflow: NonNullable<ValidateWorkflowArgs['workflowJson']>): workflow is WorkflowJSON {
  return typeof workflow.name === 'string' && Array.isArray(workflow.nodes) && typeof workflow.connections === 'object' && workflow.connections !== null;
}

function validateHttpRequestUsage(code: string, issues: ValidationIssue[]): void {
  const httpBlocks = code.match(/@node\([\s\S]*?n8n-nodes-base\.httpRequest[\s\S]*?;\n/g) || [];
  for (const block of httpBlocks) {
    addHttpRequestAlternativeIssue(block, issues, extractNodeName(block));
  }
}

function addHttpRequestAlternativeIssue(serializedNode: string, issues: ValidationIssue[], node?: string): void {
  const alternative = NATIVE_ALTERNATIVES.find((candidate) => candidate.pattern.test(serializedNode));
  if (!alternative) {
    issues.push({
      severity: 'info',
      code: 'http-request-external-api',
      node,
      message: 'HTTP Request node detected for an external API without a known native replacement.',
      recommendation: 'Keep HTTP Request only for APIs that do not have maintained native or community nodes.',
    });
    return;
  }

  issues.push({
    severity: 'warning',
    code: 'prefer-native-node',
    node,
    message: `HTTP Request appears to call ${alternative.label}.`,
    recommendation: `Use ${alternative.nativeType} with credentials instead of raw HTTP where possible.`,
  });
}

function validateErrorWorkflowReference(code: string, issues: ValidationIssue[]): void {
  if (!/errorWorkflow\s*:/i.test(code)) {
    issues.push(createErrorWorkflowIssue());
  }

  if (/n8n-nodes-base\.errorTrigger/i.test(code) && !/errorWorkflow\s*:/i.test(code)) {
    issues.push({
      severity: 'warning',
      code: 'inline-error-trigger',
      message: 'Error Trigger exists but the main workflow does not reference it through settings.errorWorkflow.',
      recommendation: 'Create a separate error workflow and set settings.errorWorkflow to that workflow id.',
    });
  }
}

function validateAiAgentPattern(code: string, issues: ValidationIssue[]): void {
  const hasAgent = /@n8n\/n8n-nodes-langchain\.agent/i.test(code);
  if (!hasAgent) {
    return;
  }

  if (!/lmChat/i.test(code)) {
    issues.push(createAiModelIssue());
  }

  if (!/\.uses\s*\(\s*\{/i.test(code) || !/ai_languageModel/i.test(code)) {
    issues.push({
      severity: 'warning',
      code: 'ai-agent-sub-node-linking',
      message: 'AI Agent should be wired to model/memory/tool sub-nodes through uses().',
      recommendation: 'Connect Chat Trigger -> Agent on main output, then Agent.uses({ ai_languageModel, ai_memory, ai_tool }).',
    });
  }
}

function validateSetVsCode(code: string, issues: ValidationIssue[]): void {
  const codeBlocks = code.match(/@node\([\s\S]*?n8n-nodes-base\.code[\s\S]*?;\n/g) || [];
  for (const block of codeBlocks) {
    if (/prepare|format|map|rename|set|transform|return\s+\{?\s*json/i.test(block)) {
      issues.push(createSetNodeIssue(extractNodeName(block)));
    }
  }
}

function validateCodeFlowControlInTypeScript(code: string, issues: ValidationIssue[]): void {
  const parts = code.split(/@node\(/);
  for (let i = 1; i < parts.length; i++) {
    const part = '@node(' + parts[i];
    if (!part.includes('n8n-nodes-base.code')) {
      continue;
    }
    const name = extractNodeName(part);
    const jsCodeMatch = part.match(/jsCode\s*:\s*(['"`])([\s\S]*?)\1/);
    if (jsCodeMatch) {
      checkCodeForFlowControl(jsCodeMatch[2], name, issues);
    }
    const pythonCodeMatch = part.match(/pythonCode\s*:\s*(['"`])([\s\S]*?)\1/);
    if (pythonCodeMatch) {
      checkCodeForFlowControl(pythonCodeMatch[2], name, issues);
    }
  }
}

function checkCodeForFlowControl(codeContent: string, nodeName: string | undefined, issues: ValidationIssue[]): void {
  const linesCount = codeContent.split('\n').length;
  const hasBranching = /if\s*\(|else|switch\s*\(|case\s+/.test(codeContent);
  const hasFiltering = /\.filter\s*\(/.test(codeContent);
  const hasLooping = /\.map\s*\(|\.forEach\s*\(|for\s*\(|while\s*\(/.test(codeContent);

  if (linesCount > 15 && (hasBranching || hasFiltering || hasLooping)) {
    issues.push({
      severity: 'warning',
      code: 'prefer-native-flow-control',
      node: nodeName,
      message: `Code node contains branching, filtering, or looping logic (${linesCount} lines) which should be implemented using native n8n nodes.`,
      recommendation: `Replace JavaScript/Python conditional/loop logic with native n8n flow control nodes:\n- Use IF (n8n-nodes-base.if) or Switch (n8n-nodes-base.switch) for branching/conditions.\n- Use Filter (n8n-nodes-base.filter) for filtering items.\n- Use Split In Batches (n8n-nodes-base.splitInBatches) for looping over items.\n- Keep Code nodes minimal and only for complex data transformations that cannot be done with Set or Merge nodes.`,
    });
  }
}

function validateCommunityNodes(code: string, issues: ValidationIssue[]): void {
  for (const [nodeType, entry] of Object.entries(NODE_REGISTRY)) {
    if (code.includes(nodeType)) {
      const communityPackage = communityPackageFor(nodeType);
      if (!communityPackage) {
        continue;
      }
      issues.push({
        severity: 'info',
        code: 'community-node-requirement',
        message: `${nodeType} is a community or optional node.`,
        recommendation: entry.installHint || `Verify ${communityPackage} is available in the target n8n instance.`,
      });
    }
  }
}

function validateCredentialReferencesInText(code: string, issues: ValidationIssue[]): void {
  for (const nodeType of Object.keys(NODE_REGISTRY)) {
    if (!code.includes(nodeType)) {
      continue;
    }

    const credentialKeys = credentialRequirementsFor(nodeType);
    const missing = credentialKeys.filter((key) => !code.includes(key));
    if (missing.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'missing-credential-reference',
        message: `${nodeType} usually requires credential references: ${missing.join(', ')}.`,
        recommendation: 'Add credentials with existing n8n credential id/name placeholders before deployment.',
      });
    }
  }
}

function createErrorWorkflowIssue(): ValidationIssue {
  return {
    severity: 'warning',
    code: 'missing-error-workflow-reference',
    message: 'Workflow does not declare settings.errorWorkflow.',
    recommendation: 'Create a separate Error Trigger workflow and set the main workflow settings.errorWorkflow to its id.',
  };
}

function createAiModelIssue(): ValidationIssue {
  return {
    severity: 'warning',
    code: 'ai-agent-missing-model',
    message: 'AI Agent detected without a chat model sub-node.',
    recommendation: 'Add @n8n/n8n-nodes-langchain.lmChatOpenAi or another lmChat node and connect it as ai_languageModel.',
  };
}

function createSetNodeIssue(node?: string): ValidationIssue {
  return {
    severity: 'warning',
    code: 'prefer-set-node',
    node,
    message: 'Code node appears to perform a simple field transform.',
    recommendation: 'Use n8n-nodes-base.set for renaming, mapping, formatting, and simple field assignments. Keep Code only for loops, grouping, or complex JavaScript.',
  };
}

function extractNodeName(block: string): string | undefined {
  return block.match(/name:\s*['"]([^'"]+)['"]/)?.[1];
}

function buildResult(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const info = issues.filter((issue) => issue.severity === 'info');
  const score = Math.max(0, 100 - errors.length * 30 - warnings.length * 10 - info.length * 2);

  return {
    valid: errors.length === 0,
    score,
    errors,
    warnings,
    info,
    summary: `Idiomatic validation: ${errors.length} error(s), ${warnings.length} warning(s), ${info.length} info item(s). Score: ${score}/100.`,
  };
}

function isErrorHandledDownstream(nodeName: string, workflow: any): boolean {
  if (!nodeName) {
    return false;
  }
  const connections = workflow.connections || {};
  const nodes = workflow.nodes || [];
  
  const visited = new Set<string>();
  const queue: string[] = [];
  
  const nodeConnections = connections[nodeName]?.main;
  if (nodeConnections) {
    for (const branch of nodeConnections) {
      for (const conn of branch) {
        if (conn?.node) {
          queue.push(conn.node);
        }
      }
    }
  }
  
  let foundCheck = false;
  while (queue.length > 0) {
    const currentName = queue.shift()!;
    if (visited.has(currentName)) {
      continue;
    }
    visited.add(currentName);
    
    const currentNode = nodes.find((n: any) => n.name === currentName);
    if (currentNode) {
      const serialized = JSON.stringify(currentNode.parameters || {});
      const escapedNodeName = nodeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const errorPattern = new RegExp('(?:\\$json|\\$\\([\'"]' + escapedNodeName + '[\'"]\\)\\.item\\.json)(?:\\.error|\\[[\'"]?error[\'"]?\\])', 'i');
      
      if (
        errorPattern.test(serialized) ||
        (serialized.includes('"error"') && /check|validate|if|filter/i.test(currentNode.type || ''))
      ) {
        foundCheck = true;
        break;
      }
    }
    
    const nextConns = connections[currentName]?.main;
    if (nextConns) {
      for (const branch of nextConns) {
        for (const conn of branch) {
          if (conn?.node && !visited.has(conn.node)) {
            queue.push(conn.node);
          }
        }
      }
    }
  }
  
  return foundCheck;
}

function validateDeprecatedCommunityNodes(code: string, issues: ValidationIssue[]): void {
  for (const rule of DEPRECATED_COMMUNITY_PACKAGES) {
    if (rule.pattern.test(code)) {
      issues.push({
        severity: rule.severity,
        code: 'deprecated-community-node',
        message: `Workflow references a deprecated or high-risk community node/package: ${rule.message}`,
        recommendation: rule.recommendation,
      });
    }
  }
}

function validateDeprecatedNativeNodes(code: string, issues: ValidationIssue[]): void {
  // Check for legacy email node: type: 'n8n-nodes-base.email'
  const emailMatch = code.match(/@node\([\s\S]*?n8n-nodes-base\.email['"][\s\S]*?\)/g);
  if (emailMatch) {
    for (const block of emailMatch) {
      issues.push({
        severity: 'warning',
        code: 'deprecated-native-node',
        node: extractNodeName(block),
        message: 'n8n-nodes-base.email is deprecated and will render as a "?" placeholder in newer n8n instances.',
        recommendation: 'Use n8n-nodes-base.emailSend (for SMTP) or n8n-nodes-base.emailReadImap (for IMAP triggers) instead.',
      });
    }
  }

  // Check for legacy start node: type: 'n8n-nodes-base.start'
  const startMatch = code.match(/@node\([\s\S]*?n8n-nodes-base\.start['"][\s\S]*?\)/g);
  if (startMatch) {
    for (const block of startMatch) {
      issues.push({
        severity: 'warning',
        code: 'deprecated-native-node',
        node: extractNodeName(block),
        message: 'n8n-nodes-base.start is deprecated and removed in newer n8n instances.',
        recommendation: 'Use n8n-nodes-base.manualTrigger instead.',
      });
    }
  }
}
