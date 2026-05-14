import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface CompileWorkflowArgs {
  typescriptCode?: string;
  filePath?: string;
}

export async function compileWorkflow(args: CompileWorkflowArgs): Promise<unknown> {
  const filePath = await resolveWorkflowFile(args);

  try {
    const transformer = await import('@n8n-as-code/transformer');
    const parser = new (transformer as any).TypeScriptParser();
    const builder = new (transformer as any).WorkflowBuilder();
    const ast = await parser.parseFile(filePath);
    return builder.build(ast);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to compile workflow TypeScript with @n8n-as-code/transformer: ${message}`);
  }
}

async function resolveWorkflowFile(args: CompileWorkflowArgs): Promise<string> {
  if (args.filePath) {
    return args.filePath;
  }

  if (!args.typescriptCode) {
    throw new Error('compile_workflow requires either typescriptCode or filePath.');
  }

  const dir = await mkdtemp(join(tmpdir(), 'n8n-workflow-mcp-'));
  const filePath = join(dir, 'generated.workflow.ts');
  await writeFile(filePath, args.typescriptCode, 'utf8');

  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true });
  };
  process.once('beforeExit', cleanup);

  return filePath;
}

export async function readWorkflowSource(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}
