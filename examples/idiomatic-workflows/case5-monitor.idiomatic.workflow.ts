// @ts-nocheck
import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
    id: 'monitor_case5_v3_idiomatic',
    name: 'Case 5: Monitor (Idiomatic)',
    active: false,
    settings: { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false, errorWorkflow: 'idiomatic-shared-error-handler' },
})
export class Case5MonitorIdiomaticWorkflow {
    @node({ id: 'case5-schedule', name: 'Daily Schedule', type: 'n8n-nodes-base.scheduleTrigger', version: 1.2, position: [120, 300] })
    Schedule = { rule: { interval: [{ field: 'days', triggerAtHour: 9 }] } };

    @node({ id: 'case5-bitrix', name: 'List Pending Deals', type: 'n8n-nodes-base.bitrix24', version: 1, position: [360, 300], credentials: { bitrix24OAuth2Api: { id: 'bitrix24-main', name: 'Bitrix24 account' } } })
    ListPendingDeals = { resource: 'deal', operation: 'getAll', returnAll: true, filter: { STAGE_ID: 'PREPARATION' } };

    @node({ id: 'case5-safe-fields', name: 'Mask Deal PII', type: 'n8n-nodes-base.set', version: 3.4, position: [600, 300] })
    MaskDealPii = {
        mode: 'manual',
        duplicateItem: false,
        assignments: { assignments: [{ id: 'id', name: 'dealId', value: '={{ $json.ID }}', type: 'string' }, { id: 'amount', name: 'amount', value: '={{ $json.OPPORTUNITY }}', type: 'number' }, { id: 'days', name: 'daysStuck', value: '={{ $now.diff(DateTime.fromISO($json.DATE_MODIFY), "days").days }}', type: 'number' }] },
        options: {},
    };

    @node({ id: 'case5-agent', name: 'Stuck Deal Analyst Agent', type: '@n8n/n8n-nodes-langchain.agent', version: 1.7, position: [840, 300] })
    StuckDealAnalystAgent = { text: '=Stuck deals: {{ JSON.stringify($input.all().map(item => item.json)) }}', options: { systemMessage: 'Write a two-sentence executive alert about stuck deals. Use only anonymized IDs and amounts. No markdown.' } };

    @node({ id: 'case5-openai-model', name: 'OpenAI Analyst Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', version: 1.2, position: [840, 540], credentials: { openAiApi: { id: 'openai-primary', name: 'OpenAI account' } } })
    OpenAiAnalystModel = { model: 'gpt-4o-mini', options: { temperature: 0.2 } };

    @node({ id: 'case5-teams', name: 'MS Teams Alert', type: 'n8n-nodes-base.microsoftTeams', version: 2, position: [1080, 300], credentials: { microsoftTeamsOAuth2Api: { id: 'microsoft-teams-main', name: 'Microsoft Teams account' } } })
    MsTeamsAlert = { resource: 'channelMessage', operation: 'create', teamId: '={{ $env.TEAMS_SALES_TEAM_ID }}', channelId: '={{ $env.TEAMS_SALES_ALERTS_CHANNEL_ID }}', message: '=EXECUTIVE ALERT (AI Analyst):\n{{ $json.output }}' };

    @links()
    defineRouting() {
        this.Schedule.out(0).to(this.ListPendingDeals.in(0));
        this.ListPendingDeals.out(0).to(this.MaskDealPii.in(0));
        this.MaskDealPii.out(0).to(this.StuckDealAnalystAgent.in(0));
        this.StuckDealAnalystAgent.out(0).to(this.MsTeamsAlert.in(0));

        this.StuckDealAnalystAgent.uses({ ai_languageModel: this.OpenAiAnalystModel.output });
    }
}
