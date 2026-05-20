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
    const workflow = builder.build(ast);

    if (workflow.nodes) {
      for (const node of workflow.nodes) {
        const settings: Record<string, any> = (node as any).settings || {};
        if ((node as any).onError) {
          if ((node as any).onError === 'continueRegularOutput' || (node as any).onError === 'continueErrorOutput') {
            settings.continueOnFail = true;
          }
        }
        if ((node as any).retryOnFail !== undefined) {
          settings.retryOnFail = (node as any).retryOnFail;
          delete (node as any).retryOnFail;
        }
        if ((node as any).maxTries !== undefined) {
          settings.maxTries = (node as any).maxTries;
          delete (node as any).maxTries;
        }
        if ((node as any).waitBetweenTries !== undefined) {
          settings.waitBetweenTries = (node as any).waitBetweenTries;
          delete (node as any).waitBetweenTries;
        }
        if (Object.keys(settings).length > 0) {
          (node as any).settings = settings;
        }
      }
    }

    return workflow;
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
