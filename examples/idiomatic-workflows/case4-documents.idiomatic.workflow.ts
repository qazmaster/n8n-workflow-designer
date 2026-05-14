// @ts-nocheck
import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
    id: 'docs_case4_v3_idiomatic',
    name: 'Case 4: Documents (Idiomatic)',
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false, errorWorkflow: 'idiomatic-shared-error-handler' },
})
export class Case4DocumentsIdiomaticWorkflow {
    @node({ id: 'case4-webhook', webhookId: '50cc7c1a-5857-465b-9c23-8ecc3e919b07', name: 'Webhook (Company + BIN)', type: 'n8n-nodes-base.webhook', version: 2, position: [120, 300] })
    WebhookCompanyBin = { httpMethod: 'POST', path: 'elite-nda', responseMode: 'onReceived', options: {} };

    @node({ id: 'case4-normalize', name: 'Normalize Company Input', type: 'n8n-nodes-base.set', version: 3.4, position: [360, 300] })
    NormalizeCompanyInput = {
        mode: 'manual',
        duplicateItem: false,
        assignments: { assignments: [{ id: 'bin', name: 'bin', value: '={{ $json.body.bin }}', type: 'string' }, { id: 'company', name: 'companyName', value: '={{ $json.body.companyName }}', type: 'string' }] },
        options: {},
    };

    @node({ id: 'case4-registry-subworkflow', name: 'Lookup Official Registry', type: 'n8n-nodes-base.executeWorkflow', version: 1.1, position: [600, 300] })
    LookupOfficialRegistry = { workflowId: { __rl: true, mode: 'id', value: 'shared-kz-registry-lookup' }, options: { waitForSubWorkflow: true } };

    @node({ id: 'case4-drafter-agent', name: 'Legal Drafter Agent', type: '@n8n/n8n-nodes-langchain.agent', version: 1.7, position: [840, 300] })
    LegalDrafterAgent = { text: '=Company input: {{ JSON.stringify($json) }}', options: { systemMessage: 'Draft NDA clauses from verified registry data. Return clean HTML with placeholders already filled. Do not invent registry facts.' } };

    @node({ id: 'case4-openai-model', name: 'OpenAI Legal Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', version: 1.2, position: [840, 540], credentials: { openAiApi: { id: 'openai-primary', name: 'OpenAI account' } } })
    OpenAiLegalModel = { model: 'gpt-4o-mini', options: { temperature: 0.15 } };

    @node({ id: 'case4-docx', name: 'Generate NDA Document', type: 'n8n-nodes-docxtemplater.docxtemplater', version: 1, position: [1080, 300] })
    GenerateNdaDocument = { templateSource: 'binary', templateBinaryProperty: 'template_file', outputBinaryProperty: 'generated_doc', data: '={{ JSON.stringify({ company_name: $json.companyName, bin: $json.bin, nda_html: $json.output }) }}' };

    @node({ id: 'case4-drive', name: 'Save NDA to Google Drive', type: 'n8n-nodes-base.googleDrive', version: 3, position: [1320, 300], credentials: { googleDriveOAuth2Api: { id: 'google-drive-main', name: 'Google Drive account' } } })
    SaveNdaToDrive = { operation: 'upload', name: '=NDA - {{ $json.companyName }}.docx', driveId: { __rl: true, mode: 'id', value: '={{ $env.GOOGLE_DRIVE_CONTRACTS_ID }}' }, folderId: { __rl: true, mode: 'id', value: '={{ $env.GOOGLE_DRIVE_CONTRACTS_FOLDER_ID }}' }, binaryData: true, binaryPropertyName: 'generated_doc', options: {} };

    @node({ id: 'case4-signature-subworkflow', name: 'Send for Signature', type: 'n8n-nodes-base.executeWorkflow', version: 1.1, position: [1560, 300] })
    SendForSignature = { workflowId: { __rl: true, mode: 'id', value: 'shared-send-document-for-signature' }, options: { waitForSubWorkflow: true } };

    @links()
    defineRouting() {
        this.WebhookCompanyBin.out(0).to(this.NormalizeCompanyInput.in(0));
        this.NormalizeCompanyInput.out(0).to(this.LookupOfficialRegistry.in(0));
        this.LookupOfficialRegistry.out(0).to(this.LegalDrafterAgent.in(0));
        this.LegalDrafterAgent.out(0).to(this.GenerateNdaDocument.in(0));
        this.GenerateNdaDocument.out(0).to(this.SaveNdaToDrive.in(0));
        this.SaveNdaToDrive.out(0).to(this.SendForSignature.in(0));

        this.LegalDrafterAgent.uses({ ai_languageModel: this.OpenAiLegalModel.output });
    }
}
