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
        expectedOutput: tc.expected.finalOutput
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

export async function evaluateExecutionResult(args: EvaluateExecutionResultArgs): Promise<{ success: boolean, results: any[] }> {
  const { executionResult, assertions } = args;
  const results: any[] = [];
  let overallSuccess = true;

  // Resolve node output data from n8n execution result
  // An execution result has a structure like: { id: "123", finished: true, data: { resultData: { runData: { "Node Name": [ { data: { main: [ [ { json: ... } ] ] } } ] } } }
  const runData = executionResult?.data?.resultData?.runData || {};

  for (const assertion of assertions) {
    const { testCaseId, nodeName, expectedOutput } = assertion;
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

    // Try to extract output JSON
    const outputItem = nodeRun[0]?.data?.main?.[0]?.[0]?.json || {};
    
    // Validate assertions
    let passed = true;
    const details: Record<string, any> = {};

    if (expectedOutput) {
      for (const key in expectedOutput) {
        const expectedVal = expectedOutput[key];
        const actualVal = outputItem[key];
        
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
      output: outputItem
    });
  }

  return {
    success: overallSuccess,
    results
  };
}
