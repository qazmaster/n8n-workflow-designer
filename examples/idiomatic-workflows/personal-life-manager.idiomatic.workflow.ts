// @ts-nocheck
import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
    id: 'mTLoeAyq37cITpg0_idiomatic',
    name: 'Personal life manager with Telegram, Google services & voice-enabled AI (Idiomatic)',
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false, errorWorkflow: 'idiomatic-shared-error-handler' },
})
export class PersonalLifeManagerIdiomaticWorkflow {
    @node({ id: 'personal-telegram-trigger', webhookId: '322dce18-f93e-4f86-b9b1-3305519b7834', name: 'Listen for incoming events', type: 'n8n-nodes-base.telegramTrigger', version: 1, position: [240, 360], credentials: { telegramApi: { id: 'telegram-personal-bot', name: 'Telegram Personal Bot' } } })
    ListenForIncomingEvents = { updates: ['message'], additionalFields: {} };

    @node({ id: 'personal-normalize-message', name: 'Normalize Telegram Message', type: 'n8n-nodes-base.set', version: 3.4, position: [480, 360] })
    NormalizeTelegramMessage = { mode: 'manual', duplicateItem: false, assignments: { assignments: [{ id: 'chat-id', name: 'chatId', value: '={{ $json.message.from.id }}', type: 'string' }, { id: 'text', name: 'text', value: '={{ $json.message.text || "" }}', type: 'string' }, { id: 'voice-file-id', name: 'voiceFileId', value: '={{ $json.message.voice?.file_id || "" }}', type: 'string' }] }, options: {} };

    @node({ id: 'personal-is-voice', name: 'Voice Message?', type: 'n8n-nodes-base.if', version: 2.2, position: [720, 360] })
    VoiceMessage = { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: 'has-voice', leftValue: '={{ $json.voiceFileId }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } }], combinator: 'and' }, options: {} };

    @node({ id: 'personal-get-voice-file', name: 'Get Voice File', type: 'n8n-nodes-base.telegram', version: 1.2, position: [960, 220], credentials: { telegramApi: { id: 'telegram-personal-bot', name: 'Telegram Personal Bot' } } })
    GetVoiceFile = { resource: 'file', fileId: '={{ $json.voiceFileId }}', additionalFields: {} };

    @node({ id: 'personal-transcribe', name: 'Transcribe Voice', type: 'n8n-nodes-base.openAi', version: 1.8, position: [1200, 220], credentials: { openAiApi: { id: 'openai-primary', name: 'OpenAI account' } } })
    TranscribeVoice = { resource: 'audio', operation: 'transcribe', binaryPropertyName: 'data', options: {} };

    @node({ id: 'personal-set-transcription', name: 'Use Transcribed Text', type: 'n8n-nodes-base.set', version: 3.4, position: [1440, 220] })
    UseTranscribedText = { mode: 'manual', duplicateItem: false, assignments: { assignments: [{ id: 'text', name: 'text', value: '={{ $json.text || $json.transcription }}', type: 'string' }, { id: 'chat-id', name: 'chatId', value: '={{ $("Normalize Telegram Message").first().json.chatId }}', type: 'string' }] }, options: {} };

    @node({ id: 'personal-assistant', name: 'Jackie AI Assistant', type: '@n8n/n8n-nodes-langchain.agent', version: 1.7, position: [1680, 360] })
    JackieAiAssistant = { promptType: 'define', text: '={{ $json.text }}', options: { systemMessage: 'You are Jackie, a helpful personal assistant. Use Gmail, Google Calendar, and Google Tasks tools when requested. If no date is specified, assume today.' } };

    @node({ id: 'personal-openai-model', name: 'OpenAI Chat Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', version: 1.2, position: [1440, 680], credentials: { openAiApi: { id: 'openai-primary', name: 'OpenAI account' } } })
    OpenAiChatModel = { model: 'gpt-4o-mini', options: { temperature: 0.3 } };

    @node({ id: 'personal-memory', name: 'Window Buffer Memory', type: '@n8n/n8n-nodes-langchain.memoryBufferWindow', version: 1.3, position: [1680, 680] })
    WindowBufferMemory = { sessionIdType: 'customKey', sessionKey: '={{ $("Normalize Telegram Message").first().json.chatId }}', contextWindowLength: 12 };

    @node({ id: 'personal-gmail-get', name: 'Get Email', type: 'n8n-nodes-base.gmailTool', version: 2.1, position: [1920, 680], credentials: { gmailOAuth2: { id: 'gmail-main', name: 'Gmail account' } } })
    GetEmail = { operation: 'getAll', limit: 20, filters: { labelIds: ['INBOX'], readStatus: 'unread', receivedAfter: "={{ $fromAI('received_after', 'Optional start date', 'string') }}", receivedBefore: "={{ $fromAI('received_before', 'Optional end date', 'string') }}" } };

    @node({ id: 'personal-gmail-send', name: 'Send Email', type: 'n8n-nodes-base.gmailTool', version: 2.1, position: [2160, 680], credentials: { gmailOAuth2: { id: 'gmail-main', name: 'Gmail account' } } })
    SendEmail = { sendTo: "={{ $fromAI('to', 'Recipient email address', 'string') }}", subject: "={{ $fromAI('subject', 'Email subject', 'string') }}", message: "={{ $fromAI('message', 'HTML email body', 'string') }}", options: { appendAttribution: false } };

    @node({ id: 'personal-calendar', name: 'Google Calendar', type: 'n8n-nodes-base.googleCalendarTool', version: 1.1, position: [2400, 680], credentials: { googleCalendarOAuth2Api: { id: 'google-calendar-main', name: 'Google Calendar account' } } })
    GoogleCalendar = { operation: 'getAll', calendar: { __rl: true, mode: 'id', value: '={{ $env.GOOGLE_CALENDAR_ID }}' }, options: { timeMin: "={{ $fromAI('after', 'Optional lower date bound', 'string') }}", timeMax: "={{ $fromAI('before', 'Optional upper date bound', 'string') }}", fields: 'items(summary,start(dateTime),end(dateTime),attendees(email))' } };

    @node({ id: 'personal-create-task', name: 'Create Google Task', type: 'n8n-nodes-base.googleTasksTool', version: 1, position: [2640, 680], credentials: { googleTasksOAuth2Api: { id: 'google-tasks-main', name: 'Google Tasks account' } } })
    CreateGoogleTask = { task: '={{ $env.GOOGLE_TASKS_LIST_ID }}', title: "={{ $fromAI('title', 'Task title', 'string') }}", additionalFields: { notes: "={{ $fromAI('notes', 'Optional task notes', 'string') }}" } };

    @node({ id: 'personal-list-tasks', name: 'Get Google Tasks', type: 'n8n-nodes-base.googleTasksTool', version: 1, position: [2880, 680], credentials: { googleTasksOAuth2Api: { id: 'google-tasks-main', name: 'Google Tasks account' } } })
    GetGoogleTasks = { operation: 'getAll', task: '={{ $env.GOOGLE_TASKS_LIST_ID }}', additionalFields: {} };

    @node({ id: 'personal-telegram-reply', webhookId: '2c133a40-af48-4106-bc1a-be6047840a89', name: 'Reply in Telegram', type: 'n8n-nodes-base.telegram', version: 1.2, position: [1920, 360], onError: 'continueErrorOutput', credentials: { telegramApi: { id: 'telegram-personal-bot', name: 'Telegram Personal Bot' } } })
    ReplyInTelegram = { chatId: '={{ $("Normalize Telegram Message").first().json.chatId }}', text: '={{ $json.output }}', additionalFields: { appendAttribution: false, parse_mode: 'Markdown' } };

    @node({ id: 'personal-error-handler', name: 'Run Error Handler', type: 'n8n-nodes-base.executeWorkflow', version: 1.1, position: [2160, 460] })
    RunErrorHandler = { workflowId: { __rl: true, mode: 'id', value: 'idiomatic-shared-error-handler' }, options: { waitForSubWorkflow: false } };

    @links()
    defineRouting() {
        this.ListenForIncomingEvents.out(0).to(this.NormalizeTelegramMessage.in(0));
        this.NormalizeTelegramMessage.out(0).to(this.VoiceMessage.in(0));
        this.VoiceMessage.out(0).to(this.GetVoiceFile.in(0));
        this.GetVoiceFile.out(0).to(this.TranscribeVoice.in(0));
        this.TranscribeVoice.out(0).to(this.UseTranscribedText.in(0));
        this.UseTranscribedText.out(0).to(this.JackieAiAssistant.in(0));
        this.VoiceMessage.out(1).to(this.JackieAiAssistant.in(0));
        this.JackieAiAssistant.out(0).to(this.ReplyInTelegram.in(0));
        this.ReplyInTelegram.out(1).to(this.RunErrorHandler.in(0));

        this.JackieAiAssistant.uses({ ai_languageModel: this.OpenAiChatModel.output, ai_memory: this.WindowBufferMemory.output, ai_tool: [this.GetEmail.output, this.SendEmail.output, this.GoogleCalendar.output, this.CreateGoogleTask.output, this.GetGoogleTasks.output] });
    }
}
