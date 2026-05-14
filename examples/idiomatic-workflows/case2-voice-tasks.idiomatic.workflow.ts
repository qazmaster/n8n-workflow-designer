// @ts-nocheck
import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
    id: 'voice_case2_v3_idiomatic',
    name: 'Case 2: Voice Tasks (Idiomatic)',
    active: false,
    settings: {
        executionOrder: 'v1',
        callerPolicy: 'workflowsFromSameOwner',
        availableInMCP: false,
        errorWorkflow: 'idiomatic-shared-error-handler',
    },
})
export class Case2VoiceTasksIdiomaticWorkflow {
    @node({ id: 'case2-webhook', webhookId: 'f4e2caad-f55d-4020-a48d-847892769724', name: 'Webhook (Voice)', type: 'n8n-nodes-base.webhook', version: 2, position: [200, 300] })
    WebhookVoice = { httpMethod: 'POST', path: 'secure-voice', responseMode: 'onReceived', options: {} };

    @node({ id: 'case2-audio-guard', name: 'Audio Payload?', type: 'n8n-nodes-base.if', version: 2.2, position: [420, 300] })
    AudioPayload = {
        conditions: {
            options: { caseSensitive: false, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{ id: 'audio-mime', leftValue: '={{ $binary.data.mimeType }}', rightValue: 'audio', operator: { type: 'string', operation: 'contains' } }],
            combinator: 'and',
        },
        options: {},
    };

    @node({ id: 'case2-transcribe', name: 'Transcribe Voice', type: 'n8n-nodes-base.openAi', version: 1.8, position: [660, 220], credentials: { openAiApi: { id: 'openai-primary', name: 'OpenAI account' } } })
    TranscribeVoice = {
        resource: 'audio',
        operation: 'transcribe',
        binaryPropertyName: 'data',
        options: { language: 'ru' },
    };

    @node({ id: 'case2-normalize', name: 'Normalize Task Request', type: 'n8n-nodes-base.set', version: 3.4, position: [900, 220] })
    NormalizeTaskRequest = {
        mode: 'manual',
        duplicateItem: false,
        assignments: { assignments: [{ id: 'voice-text', name: 'text', value: '={{ $json.text || $json.transcription || $json.body?.text }}', type: 'string' }] },
        options: {},
    };

    @node({ id: 'case2-policy-agent', name: 'Task Policy Agent', type: '@n8n/n8n-nodes-langchain.agent', version: 1.7, position: [1140, 220] })
    TaskPolicyAgent = {
        text: '={{ $json.text }}',
        options: { systemMessage: 'Extract JSON {type,title,assignee,description,pii_flag}. Set pii_flag=true when the request contains NDA, pricing, secrets, personal data, or client-sensitive information.' },
    };

    @node({ id: 'case2-openai-model', name: 'OpenAI Task Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', version: 1.2, position: [1140, 500], credentials: { openAiApi: { id: 'openai-primary', name: 'OpenAI account' } } })
    OpenAiTaskModel = { model: 'gpt-4o-mini', options: { temperature: 0.2, responseFormat: 'json_object' } };

    @node({ id: 'case2-pii-check', name: 'PII Breach?', type: 'n8n-nodes-base.if', version: 2.2, position: [1380, 220] })
    PiiBreach = {
        conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{ id: 'pii-flag', leftValue: '={{ $json.output.pii_flag || JSON.parse($json.output).pii_flag }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
            combinator: 'and',
        },
        options: {},
    };

    @node({ id: 'case2-security-alert', name: 'Send Security Alert', type: 'n8n-nodes-base.telegram', version: 1.2, position: [1620, 120], credentials: { telegramApi: { id: 'telegram-admin-bot', name: 'Telegram Admin Bot' } } })
    SendSecurityAlert = { chatId: '={{ $env.TELEGRAM_ADMIN_CHAT_ID }}', text: 'Blocked sensitive voice command. Manual review required.', additionalFields: { parse_mode: 'Markdown' } };

    @node({ id: 'case2-execute-action', name: 'Create Bitrix24 Task', type: 'n8n-nodes-base.bitrix24', version: 1, position: [1620, 340], credentials: { bitrix24OAuth2Api: { id: 'bitrix24-main', name: 'Bitrix24 account' } } })
    CreateBitrix24Task = { resource: 'task', operation: 'create', title: '={{ $json.output.title || JSON.parse($json.output).title }}', additionalFields: { description: '={{ $json.output.description || JSON.parse($json.output).description }}' } };

    @node({ id: 'case2-error-handler', name: 'Run Error Handler', type: 'n8n-nodes-base.executeWorkflow', version: 1.1, position: [660, 500] })
    RunErrorHandler = { workflowId: { __rl: true, mode: 'id', value: 'idiomatic-shared-error-handler' }, options: { waitForSubWorkflow: false } };

    @links()
    defineRouting() {
        this.WebhookVoice.out(0).to(this.AudioPayload.in(0));
        this.AudioPayload.out(0).to(this.TranscribeVoice.in(0));
        this.AudioPayload.out(1).to(this.RunErrorHandler.in(0));
        this.TranscribeVoice.out(0).to(this.NormalizeTaskRequest.in(0));
        this.NormalizeTaskRequest.out(0).to(this.TaskPolicyAgent.in(0));
        this.TaskPolicyAgent.out(0).to(this.PiiBreach.in(0));
        this.PiiBreach.out(0).to(this.SendSecurityAlert.in(0));
        this.PiiBreach.out(1).to(this.CreateBitrix24Task.in(0));

        this.TaskPolicyAgent.uses({ ai_languageModel: this.OpenAiTaskModel.output });
    }
}
