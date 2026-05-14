const { TypeScriptParser, WorkflowBuilder } = require('@n8n-as-code/transformer');
const fs = require('fs');
const path = require('path');

const N8N_API_KEY = process.env.N8N_API_KEY;
const N8N_BASE_URL = process.env.N8N_BASE_URL || 'https://my.oysana.com';

if (!N8N_API_KEY) {
  console.error('Error: N8N_API_KEY environment variable is required');
  process.exit(1);
}

const workflowsDir = path.join(__dirname, 'workflows', 'my_oysana_anuar_k', 'personal');
const workflowFiles = fs.readdirSync(workflowsDir)
  .filter(f => f.endsWith('.workflow.ts'))
  .map(f => path.join(workflowsDir, f));

async function compileWorkflow(filePath) {
  console.log(`\n📄 Compiling: ${path.basename(filePath)}`);
  
  try {
    const parser = new TypeScriptParser();
    const builder = new WorkflowBuilder();
    
    const ast = await parser.parseFile(filePath);
    const workflowJson = builder.build(ast);
    
    console.log(`   ✅ Compiled: ${workflowJson.name} (${workflowJson.nodes.length} nodes)`);
    return workflowJson;
  } catch (error) {
    console.error(`   ❌ Compilation failed: ${error.message}`);
    throw error;
  }
}

async function deployWorkflow(workflowJson) {
  const url = `${N8N_BASE_URL}/api/v1/workflows`;
  
  console.log(`   🚀 Deploying to ${url}...`);
  
  const payload = { ...workflowJson };
  delete payload.id;
  delete payload.active;
  delete payload.tags;
  if (payload.settings) {
    const allowedSettings = ['executionOrder', 'errorWorkflow', 'timezone', 'saveManualExecutions', 'saveDataErrorExecution', 'saveExecutionProgress', 'callerPolicy'];
    const filteredSettings = {};
    for (const key of allowedSettings) {
      if (key in payload.settings) {
        filteredSettings[key] = payload.settings[key];
      }
    }
    payload.settings = filteredSettings;
  }
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-N8N-API-KEY': N8N_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log(`   ✅ Deployed: ${data.name} (ID: ${data.id})`);
      return data;
    } else {
      console.error(`   ❌ Deploy failed (${response.status}):`, data.message || data);
      throw new Error(`Deploy failed: ${data.message || response.statusText}`);
    }
  } catch (error) {
    console.error(`   ❌ Deploy error: ${error.message}`);
    throw error;
  }
}

async function listWorkflows() {
  const url = `${N8N_BASE_URL}/api/v1/workflows`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'X-N8N-API-KEY': N8N_API_KEY,
      },
    });
    
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Failed to list workflows:', error.message);
    return [];
  }
}

async function main() {
  console.log('🎯 n8n Workflow Deployment');
  console.log(`   Base URL: ${N8N_BASE_URL}`);
  console.log(`   Workflows: ${workflowFiles.length} files found`);
  
  const results = [];
  
  for (const filePath of workflowFiles) {
    try {
      const workflowJson = await compileWorkflow(filePath);
      const deployed = await deployWorkflow(workflowJson);
      results.push({ success: true, file: path.basename(filePath), ...deployed });
    } catch (error) {
      results.push({ success: false, file: path.basename(filePath), error: error.message });
    }
  }
  
  console.log('\n📊 Deployment Summary');
  console.log('═══════════════════════════════════════════');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);
  
  if (successful.length > 0) {
    console.log('\nDeployed workflows:');
    successful.forEach(r => {
      console.log(`  • ${r.name} (${r.id})`);
    });
  }
  
  if (failed.length > 0) {
    console.log('\nFailed deployments:');
    failed.forEach(r => {
      console.log(`  • ${r.file}: ${r.error}`);
    });
  }
  
  console.log('\n🔍 Verifying deployment...');
  const existingWorkflows = await listWorkflows();
  console.log(`   Total workflows on server: ${existingWorkflows.length}`);
  
  successful.forEach(r => {
    const found = existingWorkflows.find(w => w.id === r.id);
    if (found) {
      console.log(`   ✅ Verified: ${found.name}`);
    } else {
      console.log(`   ⚠️  Not found in list: ${r.name}`);
    }
  });
}

main().catch(console.error);
