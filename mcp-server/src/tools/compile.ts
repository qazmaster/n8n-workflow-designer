import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TypeScriptParser, WorkflowBuilder, type N8nWorkflow } from '@n8n-as-code/transformer';

export interface CompileWorkflowArgs {
  typescriptCode?: string;
  filePath?: string;
}

interface ResolvedWorkflowFile {
  filePath: string;
  cleanup: () => Promise<void>;
}

export async function compileWorkflow(args: CompileWorkflowArgs): Promise<N8nWorkflow> {
  const { filePath, cleanup } = await resolveWorkflowFile(args);

  try {
    const parser = new TypeScriptParser();
    const builder = new WorkflowBuilder();
    const ast = await parser.parseFile(filePath);
    return builder.build(ast);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to compile workflow TypeScript with @n8n-as-code/transformer: ${message}`);
  } finally {
    await cleanup();
  }
}

async function resolveWorkflowFile(args: CompileWorkflowArgs): Promise<ResolvedWorkflowFile> {
  if (args.filePath) {
    return { filePath: args.filePath, cleanup: async () => {} };
  }

  if (!args.typescriptCode) {
    throw new Error('compile_workflow requires either typescriptCode or filePath.');
  }

  const dir = await mkdtemp(join(tmpdir(), 'n8n-workflow-mcp-'));
  const filePath = join(dir, 'generated.workflow.ts');
  await writeFile(filePath, args.typescriptCode, 'utf8');

  return { filePath, cleanup: async () => rm(dir, { recursive: true, force: true }) };
}

export async function readWorkflowSource(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}
