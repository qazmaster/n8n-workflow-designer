// @ts-nocheck
import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
    id: 'meetings_case6_v3_idiomatic',
    name: 'Case 6: Meetings (Idiomatic)',
    active: false,
    settings: { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false, errorWorkflow: 'idiomatic-shared-error-handler' },
})
export class Case6MeetingsIdiomaticWorkflow {
    @node({ id: 'case6-webhook', webhookId: '80c35311-a270-4621-b79e-d25173ac96a0', name: 'Webhook (Meeting Ended)', type: 'n8n-nodes-base.webhook', version: 2, position: [120, 300] })
    WebhookMeetingEnded = { httpMethod: 'POST', path: 'secure-fathom-hook', responseMode: 'onReceived', options: {} };

    @node({ id: 'case6-task-agent', name: 'Extract Tasks Agent', type: '@n8n/n8n-nodes-langchain.agent', version: 1.7, position: [360, 300] })
    ExtractTasksAgent = { text: '={{ $json.body.transcript }}', options: { systemMessage: 'Extract a JSON array named tasks. Each task must include title, assigneeName, dueDate, and sanitizedDescription. Mask pricing data and client PII.' } };

    @node({ id: 'case6-openai-model', name: 'OpenAI Meeting Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', version: 1.2, position: [360, 540], credentials: { openAiApi: { id: 'openai-primary', name: 'OpenAI account' } } })
    OpenAiMeetingModel = { model: 'gpt-4o-mini', options: { temperature: 0.1, responseFormat: 'json_object' } };

    @node({ id: 'case6-split-tasks', name: 'Split Tasks', type: 'n8n-nodes-base.splitOut', version: 1, position: [600, 300] })
    SplitTasks = { fieldToSplitOut: 'tasks', options: {} };

    @node({ id: 'case6-map-assignee', name: 'Map Assignee to Bitrix User', type: 'n8n-nodes-base.executeWorkflow', version: 1.1, position: [840, 300] })
    MapAssigneeToBitrixUser = { workflowId: { __rl: true, mode: 'id', value: 'shared-bitrix-user-lookup' }, options: { waitForSubWorkflow: true } };

    @node({ id: 'case6-create-task', name: 'Create Bitrix24 Task', type: 'n8n-nodes-base.bitrix24', version: 1, position: [1080, 300], credentials: { bitrix24OAuth2Api: { id: 'bitrix24-main', name: 'Bitrix24 account' } } })
    CreateBitrix24Task = { resource: 'task', operation: 'create', title: '={{ $json.title }}', additionalFields: { responsibleId: '={{ $json.bitrixUserId }}', deadline: '={{ $json.dueDate }}', description: '={{ $json.sanitizedDescription }}' } };

    @node({ id: 'case6-error-handler', name: 'Notify Error Handler', type: 'n8n-nodes-base.executeWorkflow', version: 1.1, position: [1080, 540] })
    NotifyErrorHandler = { workflowId: { __rl: true, mode: 'id', value: 'idiomatic-shared-error-handler' }, options: { waitForSubWorkflow: false } };

    @links()
    defineRouting() {
        this.WebhookMeetingEnded.out(0).to(this.ExtractTasksAgent.in(0));
        this.ExtractTasksAgent.out(0).to(this.SplitTasks.in(0));
        this.SplitTasks.out(0).to(this.MapAssigneeToBitrixUser.in(0));
        this.MapAssigneeToBitrixUser.out(0).to(this.CreateBitrix24Task.in(0));
        this.MapAssigneeToBitrixUser.error().to(this.NotifyErrorHandler.in(0));

        this.ExtractTasksAgent.uses({ ai_languageModel: this.OpenAiMeetingModel.output });
    }
}
