import * as path from 'path';
import type { TestContract } from './test-contract.js';

export interface PrepareOfflineTestSuiteArgs {
  workflowPath: string;
  testPath: string;
}

export interface PrepareIntegrationTestPlanArgs {
  workflowJson: Record<string, any>;
  contract: TestContract;
}

export interface EvaluateExecutionResultArgs {
  executionResult: any;
  assertions: any[];
}

export async function prepareOfflineTestSuite(args: PrepareOfflineTestSuiteArgs): Promise<{ testCode: string, testPath: string }> {
  const { workflowPath, testPath } = args;
  const basename = path.basename(workflowPath);
  const relativeWorkflowPath = path.relative(path.dirname(testPath), workflowPath);

  const testCode = `import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Workflow Offline Contract Tests for ${basename}', () => {
  it('should compile and load workflow structure successfully', () => {
    const workflowPath = path.resolve(__dirname, '${relativeWorkflowPath}');
    const content = fs.readFileSync(workflowPath, 'utf8');
    
    let workflowJson;
    if (workflowPath.endsWith('.ts')) {
      expect(content).toContain('@workflow');
    } else {
      workflowJson = JSON.parse(content);
      expect(workflowJson).toBeDefined();
      expect(Array.isArray(workflowJson.nodes)).toBe(true);
      expect(workflowJson.nodes.length).toBeGreaterThan(0);
    }
  });

  it('should not contain any raw credentials in node parameters', () => {
    const workflowPath = path.resolve(__dirname, '${relativeWorkflowPath}');
    const content = fs.readFileSync(workflowPath, 'utf8');
    
    if (!workflowPath.endsWith('.ts')) {
      const workflowJson = JSON.parse(content);
      for (const node of workflowJson.nodes) {
        const params = JSON.stringify(node.parameters || {});
        // Basic check for hardcoded secrets/keys in JSON
        expect(params).not.toMatch(/"api[-_]?key"\\s*:\\s*"[^={]/i);
        expect(params).not.toMatch(/"password"\\s*:\\s*"[^={]/i);
      }
    }
  });
});
`;

  return {
    testCode,
    testPath
  };
}

export async function prepareIntegrationTestPlan(args: PrepareIntegrationTestPlanArgs): Promise<Record<string, any>> {
  const { workflowJson, contract } = args;
  const nodes = workflowJson.nodes || [];

  // Find the first trigger node (or webhook) to inject pinData mock inputs
  const triggerNode = nodes.find((n: any) => 
    n.type.toLowerCase().includes('trigger') || 
    n.type === 'n8n-nodes-base.webhook'
  );
  const triggerName = triggerNode ? triggerNode.name : 'Webhook Trigger';

  // Map contract test cases to pinData overlays
  const pinData: Record<string, any> = {};
  const assertions: any[] = [];

  for (const tc of contract.testCases) {
    if (tc.input) {
      // Map inputs to the trigger node
      pinData[triggerName] = [
        {
          json: tc.input.body || tc.input.message || tc.input
        }
      ];
    }

    if (tc.expected) {
      const finalNodeName = tc.expected.pathExists 
        ? tc.expected.pathExists[tc.expected.pathExists.length - 1] 
        : undefined;

      assertions.push({
        testCaseId: tc.id,
        nodeName: finalNodeName || 'Prepare Data',
        expectedOutput: tc.expected.finalOutput,
        assertions: tc.expected.assertions,
        errorExpected: tc.expected.errorExpected,
      });
    }
  }

  const requiredTools = ['n8n_create_workflow', 'n8n_test_workflow', 'n8n_executions'];
  const recommendedNextTool = 'n8n_create_workflow';

  const instructions = `Execute the integration test plan on a sandbox/test n8n instance:\n` +
    `1. Use n8n-mcp to create/deploy the workflow named "${workflowJson.name || 'Test Workflow'}".\n` +
    `2. Execute n8n_test_workflow using the created workflow's ID, passing the mock data for trigger node "${triggerName}".\n` +
    `3. Assert the execution output matches the expected final outputs using the evaluate_execution_result tool.\n` +
    `Note: Keep the production deploy plan clean; do not deploy the test pinData directly inside the production instance.`;

  const haltInstruction = `\n\nCRITICAL: Before calling the recommended tool, check if the required n8n-mcp tools (${requiredTools.join(', ')}) are configured and available in your environment. If they are missing or if the backend cannot be reached, STOP immediately and ask the user to configure or connect their n8n-mcp server (which may be local, remote self-hosted, or hosted).`;

  return {
    mode: 'delegated',
    backend: 'n8n-mcp',
    requiredTools,
    recommendedNextTool,
    testInstanceRequired: true,
    pinData,
    assertions,
    instructions: instructions + haltInstruction
  };
}

function resolveJsonPath(obj: any, pathStr: string): any {
  if (!obj || !pathStr) return undefined;
  let cleanPath = pathStr.trim();
  if (cleanPath.startsWith('$json.')) {
    cleanPath = cleanPath.substring(6);
  } else if (cleanPath.startsWith('$json')) {
    cleanPath = cleanPath.substring(5);
  }
  cleanPath = cleanPath
    .replace(/\[\s*['"]?([^'"]+)['"]?\s*\]/g, '.$1')
    .replace(/^\./, '');
  
  if (cleanPath === '') return obj;
  
  const parts = cleanPath.split('.').filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function evaluateOperator(actual: any, operator: string, expectedVal: any): boolean {
  switch (operator) {
    case 'equals':
      if (typeof actual === 'object' && typeof expectedVal === 'object') {
        return JSON.stringify(actual) === JSON.stringify(expectedVal);
      }
      return actual == expectedVal;
    case 'contains':
      if (typeof actual === 'string') {
        return actual.includes(String(expectedVal));
      }
      if (Array.isArray(actual)) {
        return actual.some(item => {
          if (typeof item === 'object' && typeof expectedVal === 'object') {
            return JSON.stringify(item) === JSON.stringify(expectedVal);
          }
          return item == expectedVal;
        });
      }
      return false;
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'notExists':
      return actual === undefined || actual === null;
    case 'matchesRegex':
      if (typeof actual !== 'string') return false;
      try {
        const regex = new RegExp(expectedVal);
        return regex.test(actual);
      } catch {
        return false;
      }
    case 'statusCode':
      return Number(actual) === Number(expectedVal);
    case 'lessThan':
      return Number(actual) < Number(expectedVal);
    case 'greaterThan':
      return Number(actual) > Number(expectedVal);
    default:
      return false;
  }
}

export async function evaluateExecutionResult(args: EvaluateExecutionResultArgs): Promise<{ success: boolean, results: any[] }> {
  const { executionResult, assertions } = args;
  const results: any[] = [];
  let overallSuccess = true;

  const runData = executionResult?.data?.resultData?.runData || {};

  for (const assertion of assertions) {
    const { testCaseId, nodeName, expectedOutput, assertions: richAssertions, errorExpected } = assertion;
    const nodeRun = runData[nodeName];

    if (!nodeRun || nodeRun.length === 0) {
      results.push({
        testCaseId,
        nodeName,
        passed: false,
        error: `Node "${nodeName}" was not executed, or execution log is missing.`
      });
      overallSuccess = false;
      continue;
    }

    const outputItems: any[] = [];
    let hasError = false;
    let nodeError: any = null;

    for (const run of nodeRun) {
      if (run.error) {
        hasError = true;
        nodeError = run.error;
      }
      const mainData = run.data?.main || [];
      for (const branch of mainData) {
        if (Array.isArray(branch)) {
          for (const item of branch) {
            if (item && item.json) {
              outputItems.push(item.json);
            }
          }
        }
      }
    }

    if (errorExpected) {
      if (hasError) {
        results.push({
          testCaseId,
          nodeName,
          passed: true,
          details: { errorExpected: { expected: true, actual: true, match: true } },
          error: nodeError
        });
      } else {
        results.push({
          testCaseId,
          nodeName,
          passed: false,
          details: { errorExpected: { expected: true, actual: false, match: false } },
          error: 'Expected node execution to fail, but it succeeded.'
        });
        overallSuccess = false;
      }
      continue;
    } else {
      if (hasError) {
        results.push({
          testCaseId,
          nodeName,
          passed: false,
          details: { errorExpected: { expected: false, actual: true, match: false } },
          error: `Node execution failed unexpectedly: ${nodeError?.message || 'Unknown error'}`
        });
        overallSuccess = false;
        continue;
      }
    }

    const primaryItem = outputItems[0] || {};
    let passed = true;
    const details: Record<string, any> = {};

    if (Array.isArray(richAssertions)) {
      for (let idx = 0; idx < richAssertions.length; idx++) {
        const assertItem = richAssertions[idx];
        const field = assertItem.field || '';
        const operator = assertItem.operator;
        const expectedVal = assertItem.value;

        let match = false;
        let actualVal: any;

        if (operator === 'anyItem') {
          actualVal = outputItems;
          match = outputItems.some(item => {
            const val = resolveJsonPath(item, field);
            if (expectedVal && typeof expectedVal === 'object' && 'operator' in expectedVal && 'value' in expectedVal) {
              return evaluateOperator(val, expectedVal.operator, expectedVal.value);
            }
            return evaluateOperator(val, 'equals', expectedVal);
          });
        } else if (operator === 'allItems') {
          actualVal = outputItems;
          match = outputItems.length > 0 && outputItems.every(item => {
            const val = resolveJsonPath(item, field);
            if (expectedVal && typeof expectedVal === 'object' && 'operator' in expectedVal && 'value' in expectedVal) {
              return evaluateOperator(val, expectedVal.operator, expectedVal.value);
            }
            return evaluateOperator(val, 'equals', expectedVal);
          });
        } else if (operator === 'itemCount') {
          let count = 0;
          if (field) {
            count = outputItems.filter(item => {
              const val = resolveJsonPath(item, field);
              return val !== undefined && val !== null;
            }).length;
          } else {
            count = outputItems.length;
          }
          actualVal = count;
          if (typeof expectedVal === 'number') {
            match = count === expectedVal;
          } else if (expectedVal && typeof expectedVal === 'object' && 'operator' in expectedVal && 'value' in expectedVal) {
            match = evaluateOperator(count, expectedVal.operator, expectedVal.value);
          } else {
            match = false;
          }
        } else if (operator === 'containsItemWhere') {
          actualVal = outputItems;
          if (expectedVal && typeof expectedVal === 'object') {
            match = outputItems.some(item => {
              return Object.entries(expectedVal).every(([k, v]) => {
                const val = resolveJsonPath(item, k);
                return val == v;
              });
            });
          } else {
            match = false;
          }
        } else {
          actualVal = resolveJsonPath(primaryItem, field);
          match = evaluateOperator(actualVal, operator, expectedVal);
        }

        if (!match) {
          passed = false;
        }
        details[`assertion_${idx}`] = {
          field,
          operator,
          expected: expectedVal,
          actual: actualVal,
          match
        };
      }
    }

    if (expectedOutput) {
      for (const key in expectedOutput) {
        const expectedVal = expectedOutput[key];
        const actualVal = primaryItem[key];
        
        if (actualVal !== expectedVal) {
          passed = false;
          details[key] = { expected: expectedVal, actual: actualVal, match: false };
        } else {
          details[key] = { expected: expectedVal, actual: actualVal, match: true };
        }
      }
    }

    if (!passed) {
      overallSuccess = false;
    }

    results.push({
      testCaseId,
      nodeName,
      passed,
      details,
      output: primaryItem,
      outputs: outputItems
    });
  }

  return {
    success: overallSuccess,
    results
  };
}
