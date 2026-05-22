export interface TestCase {
  id: string;
  input?: any;
  expected: {
    pathExists?: string[];
    finalOutput?: any;
  };
}

export interface ForbiddenCriteria {
  credentials?: boolean;
  nodes?: string[];
}

export interface TestContract {
  workflowName: string;
  testCases: TestCase[];
  forbidden?: ForbiddenCriteria;
}

export interface ContractValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface GenerateTestContractArgs {
  prompt: string;
  workflowSpec?: string;
}

export interface ValidateWorkflowAgainstContractArgs {
  workflowJson: Record<string, any>;
  contract: TestContract;
}

export async function generateTestContract(args: GenerateTestContractArgs): Promise<TestContract> {
  const { prompt, workflowSpec } = args;
  const lowerPrompt = prompt.toLowerCase();
  const lowerSpec = workflowSpec ? workflowSpec.toLowerCase() : '';

  // Extract workflow name
  let workflowName = 'Generated Workflow Test Contract';
  const nameMatch = prompt.match(/(?:workflow|name|for)\s*['"`]?([^'"`\n]+)['"`]?/i);
  if (nameMatch && nameMatch[1]) {
    workflowName = nameMatch[1].trim();
  }

  // Scan workflowSpec for node names
  let nodeNames: string[] = [];
  if (workflowSpec) {
    try {
      const json = JSON.parse(workflowSpec);
      if (json && Array.isArray(json.nodes)) {
        nodeNames = json.nodes.map((n: any) => n.name).filter(Boolean);
      }
    } catch {
      // Fallback: extract using regex from typescript code
      const nameRegex = /name:\s*['"`]([^'"`\n]+)['"`]/g;
      let match;
      while ((match = nameRegex.exec(workflowSpec)) !== null) {
        if (match[1] && !nodeNames.includes(match[1])) {
          nodeNames.push(match[1]);
        }
      }
    }
  }

  const testCases: TestCase[] = [];

  // Generate test cases based on keywords
  if (lowerPrompt.includes('lead') || lowerPrompt.includes('crm') || lowerPrompt.includes('bitrix')) {
    const triggerNode = nodeNames.find(n => n.toLowerCase().includes('trigger') || n.toLowerCase().includes('webhook')) || 'Webhook Trigger';
    const crmNode = nodeNames.find(n => n.toLowerCase().includes('bitrix') || n.toLowerCase().includes('crm')) || 'Bitrix24 CRM Action';
    
    testCases.push({
      id: 'create_crm_lead',
      input: {
        body: {
          lead_id: 1001,
          name: 'TDD Test User',
          phone: '+79991112233',
          email: 'tdd@example.com'
        }
      },
      expected: {
        pathExists: [triggerNode, crmNode],
        finalOutput: {
          dealCreated: true
        }
      }
    });
  } else if (lowerPrompt.includes('telegram') || lowerPrompt.includes('bot')) {
    const triggerNode = nodeNames.find(n => n.toLowerCase().includes('telegram') || n.toLowerCase().includes('trigger')) || 'Telegram Trigger';
    const notifyNode = nodeNames.find(n => n.toLowerCase().includes('notify') || n.toLowerCase().includes('alert') || n.toLowerCase().includes('telegram')) || 'Telegram Action';
    
    testCases.push({
      id: 'telegram_incoming_message',
      input: {
        message: {
          text: 'TDD Status Check',
          chat: { id: 123456 }
        }
      },
      expected: {
        pathExists: [triggerNode, notifyNode]
      }
    });
  } else if (lowerPrompt.includes('email') || lowerPrompt.includes('imap') || lowerPrompt.includes('outlook')) {
    const triggerNode = nodeNames.find(n => n.toLowerCase().includes('imap') || n.toLowerCase().includes('email') || n.toLowerCase().includes('trigger')) || 'Email Read IMAP';
    const sendNode = nodeNames.find(n => n.toLowerCase().includes('send') || n.toLowerCase().includes('email') || n.toLowerCase().includes('outlook')) || 'Email Send Action';
    
    testCases.push({
      id: 'incoming_email_trigger',
      input: {
        subject: 'TDD Test Subject',
        from: 'test@example.com',
        text: 'Hello from TDD'
      },
      expected: {
        pathExists: [triggerNode, sendNode]
      }
    });
  } else {
    // Default fallback test case
    const triggerNode = nodeNames[0] || 'Webhook Trigger';
    const finalNode = nodeNames[nodeNames.length - 1] || 'Prepare Data';
    
    testCases.push({
      id: 'default_test_case',
      input: {
        testMode: true
      },
      expected: {
        pathExists: triggerNode !== finalNode ? [triggerNode, finalNode] : [triggerNode]
      }
    });
  }

  return {
    workflowName,
    testCases,
    forbidden: {
      credentials: true,
      nodes: ['realExternalCalls']
    }
  };
}

export async function validateWorkflowAgainstContract(args: ValidateWorkflowAgainstContractArgs): Promise<ContractValidationResult> {
  const { workflowJson, contract } = args;
  const errors: string[] = [];
  const warnings: string[] = [];

  const nodes = workflowJson.nodes || [];
  const connections = workflowJson.connections || {};

  // Build node name map and type map
  const nodeNames = new Set<string>();
  const nodeTypes = new Set<string>();
  for (const node of nodes) {
    if (node.name) {
      nodeNames.add(node.name);
    }
    if (node.type) {
      nodeTypes.add(node.type);
    }
  }

  // 1. Forbidden check
  if (contract.forbidden) {
    // Check credentials
    if (contract.forbidden.credentials) {
      for (const node of nodes) {
        // If parameters contain raw sensitive keys
        const paramsStr = JSON.stringify(node.parameters || {});
        const sensitiveRegexes = [
          /api[-_]?key/i,
          /password/i,
          /token/i,
          /secret/i,
          /auth[-_]?token/i
        ];
        
        for (const regex of sensitiveRegexes) {
          if (regex.test(paramsStr)) {
            // Check if value is a plain text or not an expression starting with =
            const params = node.parameters || {};
            for (const key in params) {
              if (regex.test(key)) {
                const val = params[key];
                if (typeof val === 'string' && val.trim() !== '' && !val.startsWith('=')) {
                  errors.push(`Node "${node.name}" contains hardcoded credential/secret parameter "${key}". Use credentials instead.`);
                }
              }
            }
          }
        }
      }
    }

    // Check forbidden nodes
    if (Array.isArray(contract.forbidden.nodes)) {
      for (const forbiddenType of contract.forbidden.nodes) {
        for (const node of nodes) {
          if (node.type === forbiddenType || node.name === forbiddenType) {
            errors.push(`Workflow contains forbidden node "${node.name}" (${node.type}).`);
          }
        }
      }
    }
  }

  // Check deprecated node types
  const deprecatedNodeTypes = ['n8n-nodes-base.email', 'n8n-nodes-base.start'];
  for (const node of nodes) {
    if (deprecatedNodeTypes.includes(node.type)) {
      warnings.push(`Node "${node.name}" uses deprecated node type "${node.type}". Consider replacing it.`);
    }
  }

  // 2. Build adjacency list for connectivity path validation
  const adjList: Record<string, string[]> = {};
  for (const srcNode in connections) {
    adjList[srcNode] = [];
    const srcConns = connections[srcNode];
    // Traverse all outputs: main, error, etc.
    for (const outputType in srcConns) {
      const paths = srcConns[outputType];
      if (Array.isArray(paths)) {
        for (const targetList of paths) {
          if (Array.isArray(targetList)) {
            for (const target of targetList) {
              if (target && target.node) {
                adjList[srcNode].push(target.node);
              }
            }
          }
        }
      }
    }
  }

  // BFS helper to check path existence
  const hasPath = (start: string, end: string): boolean => {
    if (start === end) return true;
    const visited = new Set<string>();
    const queue = [start];
    visited.add(start);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = adjList[current] || [];
      for (const neighbor of neighbors) {
        if (neighbor === end) return true;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return false;
  };

  // 3. Validate test cases
  for (const tc of contract.testCases) {
    const { pathExists } = tc.expected;
    if (Array.isArray(pathExists)) {
      for (const nodeName of pathExists) {
        if (!nodeNames.has(nodeName)) {
          errors.push(`Test case "${tc.id}" expected node "${nodeName}" to exist, but it was not found.`);
        }
      }

      // Check sequential paths
      for (let i = 0; i < pathExists.length - 1; i++) {
        const start = pathExists[i];
        const end = pathExists[i + 1];
        if (nodeNames.has(start) && nodeNames.has(end)) {
          if (!hasPath(start, end)) {
            errors.push(`Test case "${tc.id}" expected a path from "${start}" to "${end}", but no connection path exists.`);
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
