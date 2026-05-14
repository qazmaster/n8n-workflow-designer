// @ts-nocheck
import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
    id: 'mbOA5vWBqX1eQbcV_idiomatic',
    name: 'Process large documents with OCR using SubworkflowAI and Gemini (Idiomatic)',
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false, errorWorkflow: 'idiomatic-shared-error-handler' },
})
export class ProcessLargeDocumentsOcrIdiomaticWorkflow {
    @node({ id: 'docs-manual-trigger', name: 'When clicking Execute workflow', type: 'n8n-nodes-base.manualTrigger', version: 1, position: [240, 360] })
    WhenClickingExecuteWorkflow = {};

    @node({ id: 'docs-download-file', name: 'Download file', type: 'n8n-nodes-base.googleDrive', version: 3, position: [480, 360], credentials: { googleDriveOAuth2Api: { id: 'google-drive-main', name: 'Google Drive account' } } })
    DownloadFile = { operation: 'download', fileId: { __rl: true, mode: 'id', value: '={{ $env.OCR_SOURCE_FILE_ID }}' }, options: {} };

    @node({ id: 'docs-extract-subworkflow', name: 'Run Subworkflow Extract', type: 'n8n-nodes-base.executeWorkflow', version: 1.1, position: [720, 360] })
    RunSubworkflowExtract = { workflowId: { __rl: true, mode: 'id', value: 'shared-subworkflowai-extract' }, options: { waitForSubWorkflow: true } };

    @node({ id: 'docs-job-complete', name: 'Job Complete?', type: 'n8n-nodes-base.if', version: 2.2, position: [960, 360] })
    JobComplete = { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: 'job-complete', leftValue: '={{ $json.data.status }}', rightValue: 'completed', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, options: {} };

    @node({ id: 'docs-check-status', name: 'Check Job Status', type: 'n8n-nodes-base.executeWorkflow', version: 1.1, position: [960, 600] })
    CheckJobStatus = { workflowId: { __rl: true, mode: 'id', value: 'shared-subworkflowai-job-status' }, options: { waitForSubWorkflow: true } };

    @node({ id: 'docs-wait', name: 'Wait Before Polling', type: 'n8n-nodes-base.wait', version: 1.1, position: [720, 600] })
    WaitBeforePolling = { amount: 1, unit: 'minutes' };

    @node({ id: 'docs-get-dataset', name: 'Get Dataset', type: 'n8n-nodes-base.executeWorkflow', version: 1.1, position: [1200, 360] })
    GetDataset = { workflowId: { __rl: true, mode: 'id', value: 'shared-subworkflowai-get-dataset' }, options: { waitForSubWorkflow: true } };

    @node({ id: 'docs-get-pages', name: 'Get Dataset Pages', type: 'n8n-nodes-base.executeWorkflow', version: 1.1, position: [1440, 360] })
    GetDatasetPages = { workflowId: { __rl: true, mode: 'id', value: 'shared-subworkflowai-get-pages' }, options: { waitForSubWorkflow: true } };

    @node({ id: 'docs-split-pages', name: 'Split Pages', type: 'n8n-nodes-base.splitOut', version: 1, position: [1680, 360] })
    SplitPages = { fieldToSplitOut: 'data', options: {} };

    @node({ id: 'docs-gemini-ocr', name: 'Document OCR via Gemini', type: 'n8n-nodes-base.googleGemini', version: 1, position: [1920, 360], credentials: { googlePalmApi: { id: 'google-gemini-main', name: 'Google Gemini account' } } })
    DocumentOcrViaGemini = { resource: 'image', operation: 'analyze', modelId: { __rl: true, mode: 'list', value: 'models/gemini-2.5-flash', cachedResultName: 'models/gemini-2.5-flash' }, text: 'Transcribe this page image to Markdown.', imageUrls: '={{ $json.share.url }}', options: {} };

    @node({ id: 'docs-error-handler', name: 'Run Error Handler', type: 'n8n-nodes-base.executeWorkflow', version: 1.1, position: [1920, 600] })
    RunErrorHandler = { workflowId: { __rl: true, mode: 'id', value: 'idiomatic-shared-error-handler' }, options: { waitForSubWorkflow: false } };

    @links()
    defineRouting() {
        this.WhenClickingExecuteWorkflow.out(0).to(this.DownloadFile.in(0));
        this.DownloadFile.out(0).to(this.RunSubworkflowExtract.in(0));
        this.RunSubworkflowExtract.out(0).to(this.JobComplete.in(0));
        this.JobComplete.out(0).to(this.GetDataset.in(0));
        this.GetDataset.out(0).to(this.GetDatasetPages.in(0));
        this.GetDatasetPages.out(0).to(this.SplitPages.in(0));
        this.SplitPages.out(0).to(this.DocumentOcrViaGemini.in(0));
        this.JobComplete.out(1).to(this.CheckJobStatus.in(0));
        this.CheckJobStatus.out(0).to(this.WaitBeforePolling.in(0));
        this.WaitBeforePolling.out(0).to(this.JobComplete.in(0));
        this.DocumentOcrViaGemini.error().to(this.RunErrorHandler.in(0));
    }
}
