// @ts-nocheck
import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
    id: 'hFGWvy7yhURZpZwf_idiomatic',
    name: 'Build your first AI agent (Idiomatic)',
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false, errorWorkflow: 'idiomatic-shared-error-handler' },
})
export class BuildYourFirstAiAgentIdiomaticWorkflow {
    @node({ id: 'first-agent-chat', webhookId: 'e5616171-e3b5-4c39-81d4-67409f9fa60a', name: 'Example Chat', type: '@n8n/n8n-nodes-langchain.chatTrigger', version: 1.1, position: [320, 320] })
    ExampleChat = { public: true, initialMessages: 'Hi there! How can I help?', options: { inputPlaceholder: 'Ask for news, weather, or an agent demo...', showWelcomeScreen: false, responseMode: 'lastNode' } };

    @node({ id: 'first-agent', name: 'Your First AI Agent', type: '@n8n/n8n-nodes-langchain.agent', version: 1.7, position: [560, 320] })
    YourFirstAiAgent = {
        promptType: 'define',
        text: '={{ $json.chatInput }}',
        options: { systemMessage: 'You are a concise demo assistant for n8n AI Agents. Use tools when the user asks for live news or weather. Explain results clearly.' },
    };

    @node({ id: 'first-agent-openai', name: 'OpenAI Chat Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', version: 1.2, position: [560, 560], credentials: { openAiApi: { id: 'openai-primary', name: 'OpenAI account' } } })
    OpenAiChatModel = { model: 'gpt-4o-mini', options: { temperature: 0.4 } };

    @node({ id: 'first-agent-memory', name: 'Conversation Memory', type: '@n8n/n8n-nodes-langchain.memoryBufferWindow', version: 1.3, position: [800, 560] })
    ConversationMemory = { contextWindowLength: 30 };

    @node({ id: 'first-agent-news', name: 'Get News', type: 'n8n-nodes-base.rssFeedReadTool', version: 1.2, position: [1040, 560] })
    GetNews = { toolDescription: 'Read a public RSS feed selected by the agent.', url: "={{ $fromAI('rss_url', 'RSS feed URL to read', 'string') }}", options: {} };

    @node({ id: 'first-agent-weather', name: 'Get Weather', type: 'n8n-nodes-base.openWeatherMapTool', version: 1, position: [1280, 560], credentials: { openWeatherMapApi: { id: 'openweather-main', name: 'OpenWeatherMap account' } } })
    GetWeather = { toolDescription: 'Get current weather for a city.', cityName: "={{ $fromAI('city', 'City name for the weather request', 'string') }}", options: {} };

    @links()
    defineRouting() {
        this.ExampleChat.out(0).to(this.YourFirstAiAgent.in(0));

        this.YourFirstAiAgent.uses({ ai_languageModel: this.OpenAiChatModel.output, ai_memory: this.ConversationMemory.output, ai_tool: [this.GetNews.output, this.GetWeather.output] });
    }
}
