// @ts-nocheck
import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
    id: 'reporting_case3_v3_idiomatic',
    name: 'Case 3: Reporting (Idiomatic)',
    active: false,
    settings: { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false, errorWorkflow: 'idiomatic-shared-error-handler' },
})
export class Case3ReportingIdiomaticWorkflow {
    @node({ id: 'case3-schedule', name: 'Cron (Bi-weekly)', type: 'n8n-nodes-base.scheduleTrigger', version: 1.2, position: [120, 300] })
    CronBiWeekly = { rule: { interval: [{ field: 'weeks', interval: 2 }] } };

    @node({ id: 'case3-fetch-deals', name: 'Fetch Bitrix24 Deals', type: 'n8n-nodes-base.bitrix24', version: 1, position: [360, 300], credentials: { bitrix24OAuth2Api: { id: 'bitrix24-main', name: 'Bitrix24 account' } } })
    FetchBitrix24Deals = { resource: 'deal', operation: 'getAll', returnAll: true, filter: { STAGE_ID: 'PREPARATION' } };

    @node({ id: 'case3-safe-fields', name: 'Keep Safe Pipeline Fields', type: 'n8n-nodes-base.set', version: 3.4, position: [600, 300] })
    KeepSafePipelineFields = {
        mode: 'manual',
        duplicateItem: false,
        assignments: {
            assignments: [
                { id: 'stage', name: 'stage', value: '={{ $json.STAGE_ID }}', type: 'string' },
                { id: 'value', name: 'value', value: '={{ $json.OPPORTUNITY }}', type: 'number' },
                { id: 'days', name: 'daysInStage', value: '={{ $now.diff(DateTime.fromISO($json.DATE_MODIFY), "days").days }}', type: 'number' },
            ],
        },
        options: {},
    };

    @node({ id: 'case3-cro-agent', name: 'CRO Analysis Agent', type: '@n8n/n8n-nodes-langchain.agent', version: 1.7, position: [840, 300] })
    CroAnalysisAgent = { text: '=Pipeline rows: {{ JSON.stringify($input.all().map(item => item.json)) }}', options: { systemMessage: 'You are a Chief Revenue Officer. Analyze anonymized pipeline data and return two concise executive risks with financial impact.' } };

    @node({ id: 'case3-openai-model', name: 'OpenAI Reporting Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', version: 1.2, position: [840, 540], credentials: { openAiApi: { id: 'openai-primary', name: 'OpenAI account' } } })
    OpenAiReportingModel = { model: 'gpt-4o-mini', options: { temperature: 0.2 } };

    @node({ id: 'case3-teams', name: 'Send Exec Summary', type: 'n8n-nodes-base.microsoftTeams', version: 2, position: [1080, 300], credentials: { microsoftTeamsOAuth2Api: { id: 'microsoft-teams-main', name: 'Microsoft Teams account' } } })
    SendExecSummary = { resource: 'channelMessage', operation: 'create', teamId: '={{ $env.TEAMS_EXEC_TEAM_ID }}', channelId: '={{ $env.TEAMS_EXEC_CHANNEL_ID }}', message: '=AI Pipeline Analysis:\n{{ $json.output }}' };

    @links()
    defineRouting() {
        this.CronBiWeekly.out(0).to(this.FetchBitrix24Deals.in(0));
        this.FetchBitrix24Deals.out(0).to(this.KeepSafePipelineFields.in(0));
        this.KeepSafePipelineFields.out(0).to(this.CroAnalysisAgent.in(0));
        this.CroAnalysisAgent.out(0).to(this.SendExecSummary.in(0));

        this.CroAnalysisAgent.uses({ ai_languageModel: this.OpenAiReportingModel.output });
    }
}
