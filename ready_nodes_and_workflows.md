# Список протестированных нод и шаблонов для импорта (Рынок СНГ и Казахстана)

Этот файл содержит список проверенных и готовых к интеграции ресурсов для n8n.

## 1. Готовые шаблоны воркфлоу (Workflows)

| ID | Название | Ключевые ноды | Описание |
| :--- | :--- | :--- | :--- |
| **6270** | Build Your First AI Agent | `Chat Trigger, AI Agent, Gemini, Memory, RSS/Weather Tools` | Базовый чат-бот с инструментами. Безопасен, подходит для демонстрации ИИ-агентов. |
| **5993** | Documentation Expert Bot with RAG, Gemini, and Supabase | `Chat Trigger, AI Agent, Supabase Vector Store, Gemini Embeddings` | Полноценный RAG-пайплайн индексации и поиска по базе знаний Supabase. |
| **5148** | Local Chatbot with RAG | `Form Trigger, Qdrant Vector Store, Ollama, Llama 3.2` | Полностью локальный приватный RAG (без внешних облачных провайдеров). |
| **4696** | Conversational Telegram Bot for Text and Voice | `Telegram Trigger, OpenAI (Whisper + GPT-4o), Memory` | Интеграция голосовых сообщений и ИИ-ответов в Telegram Bot. |
| **4722** | Gmail AI Email Manager | `Gmail Trigger, Claude Sonnet, Gmail Tools, Structured Output` | Категоризация входящей почты через LLM со структурированным выводом. |

## 2. Безопасные и популярные комьюнити-ноды (Nodes)

| Пакет (npm) | Загрузок/мес | Последнее обновление | Описание |
| :--- | :--- | :--- | :--- |
| `@devlikeapro/n8n-nodes-chatwoot` | 35333 | 2025-06-11 | n8n node to connect with ChatWoot |
| `n8n-nodes-alive5` | 6663 | 2026-02-13 | Send and receive SMS messages via alive5 |
| `n8n-nodes-stevomanager` | 523 | 2026-02-22 | A StevoManager API é um hub de canais com foco no WhatsApp |
| `n8n-nodes-ai-media-generate` | 303 | 2026-01-31 | n8n community node for AI media generation - Generate images and videos using various AI platforms |
| `n8n-nodes-pdforge` | 5106 | 2025-12-03 | pdf noodle (previously pdforge) automates PDF Generation in minutes using AI.Create custom PDF templ... |
| `n8n-nodes-pdfco` | 7185 | 2025-08-21 | Pdf.co nodes for n8n |
| `n8n-nodes-docx-filler` | 282 | 2026-01-08 | Nodes n8n pour créer et remplir des templates DOCX/PDF avec des tags {{TAG}}. TemplateMapper (Transf... |
| `n8n-nodes-htmlcsstopdf` | 48769 | 2026-04-01 | n8n community node to convert HTML and CSS to PDF using PdfMunk API - perfect for invoices, reports,... |
| `@custom-js/n8n-nodes-pdf-toolkit` | 7530 | 2026-02-18 | This is official node for interacting with APIs from customjs.space |
| `@mendable/n8n-nodes-firecrawl` | 13884 | 2026-05-17 | Official Firecrawl nodes for n8n - scrape, crawl, map, search, and extract data from websites. Suppo... |
| `n8n-nodes-puppeteer` | 22431 | 2026-01-23 | n8n node for browser automation using Puppeteer |
| `n8n-nodes-serpapi` | 16125 | 2026-03-26 | Official n8n node for SerpApi |
| `n8n-nodes-globals` | 215317 | 2025-06-20 | N8N community node that allows users to create global constants and use them in all their workflows |
| `n8n-nodes-datastore` | 1517 | 2025-06-02 | Datastore for n8n within the workflow |
| `n8n-nodes-cronlytic` | 4434 | 2025-06-21 | n8n community node for Cronlytic advanced cron scheduling |
| `n8n-nodes-tesseractjs` | 5175 | 2025-11-12 | A n8n module that exposes Tesseract.js, an OCR library that can detect text on images |
| `@splainez/n8n-nodes-phonenumber-parser` | 2732 | 2025-10-16 | Parse a phone number and return its information |
| `@brave/n8n-nodes-brave-search` | 9470 | 2026-05-14 | A n8n node for the Brave Search API |
| `@tavily/n8n-nodes-tavily` | 18719 | 2026-01-29 | A community node for n8n to integrate Tavily API for web search and content extraction. |
| `@apify/n8n-nodes-apify` | 39139 | 2026-05-11 | n8n nodes for Apify |
| `@cloudconvert/n8n-nodes-cloudconvert` | 8402 | 2026-03-05 | n8n node for CloudConvert - an online file conversion and processing API which allows to convert fil... |
| `n8n-nodes-transcript-lol` | 57385 | 2026-03-06 | n8n community node for Transcript.lol - AI-powered audio and video transcription service |
| `n8n-nodes-instagram-token` | 7150 | 2025-11-20 | N8N nodes for Instagram API integration with access token authentication |
| `n8n-nodes-powerbi` | 12597 | 2026-05-17 | n8n nodes for integration with Power BI APIs |
| `n8n-nodes-qdrant` | 19721 | 2025-11-05 | Official n8n node to interface with Qdrant - https://qdrant.tech |
| `@justbrunasso/n8n-nodes-glpi` | 483 | 2025-12-29 | GLPI Rest API Node compatible with GLPI 9.x and above. |
| `n8n-nodes-dataforseo` | 2077 | 2026-04-21 | DataForSEO is an SEO and marketing data provider, empowering businesses with invaluable insights via... |
| `n8n-nodes-instagram-integrations` | 18184 | 2025-12-02 | N8N nodes for Instagram API integration with OAuth2 authentication |
| `n8n-nodes-awork` | 820 | 2026-03-31 | Automate your workflows with the awork API |
| `n8n-nodes-comfyui-all` | 328 | 2026-01-17 | n8n community nodes for ComfyUI workflow execution with dynamic parameter support |
| `n8n-nodes-binance` | 1403 | 2025-10-31 | N8N nodes for Binance Exchange |
| `@skriptfabrik/n8n-nodes-moco` | 467 | 2026-02-16 | MOCO community nodes for n8n |
| `@yuniruyuni/n8n-nodes-twitch` | 289 | 2026-03-16 | n8n node for Twitch API integration. Supports Twitch operations and EventSub triggers. |
| `n8n-nodes-shortio` | 973 | 2026-01-14 | A custom n8n node to work with short.io, a custom short link service. This is a community project, I... |
| `@mookielianhd/n8n-nodes-instagram` | 36153 | 2026-03-17 | Instagram node for n8n |
| `n8n-nodes-confirm8` | 158 | 2025-12-22 | Simple n8n node for Confirm8 API - no credentials needed |
| `n8n-nodes-metricool-or` | 60 | 2026-01-05 | n8n node to integrate with Metricool social media management platform |
| `@elevenlabs/n8n-nodes-elevenlabs` | 42372 | 2026-03-31 | Official ElevenLabs node for n8n |
| `n8n-nodes-mcp` | 128519 | 2026-01-02 | MCP nodes for n8n  |
| `n8n-nodes-palatine-speech` | 564634 | 2026-01-03 | Official n8n node for Palatine Speech API: transcription, diarization, sentiment analysis, summariza... |
| `n8n-nodes-aiscraper` | 2268 | 2026-04-03 | n8n node to call Parsera API for AI Scraping |
| `n8n-nodes-zohozeptomail` | 1771 | 2025-10-24 | This is an n8n community node. It lets you use Zoho ZeptoMail in your n8n workflows. |
| `n8n-nodes-a2a` | 81 | 2025-06-03 | n8n community node for A2A (Account to Account) transfers, account management, and Google Agent2Agen... |
| `n8n-nodes-rd-station-crm` | 120647 | 2025-05-28 | Nós personalizados do n8n para integração com a API do RD Station CRM (v1) |
| `@telnyx/n8n-nodes-telnyx-ai` | 3385 | 2025-07-31 | Official Telnyx AI node for n8n |
| `@pdfgeneratorapi/n8n-nodes-pdf-generator-api` | 8001 | 2025-10-06 | PDF Generator API Node for n8n |
| `n8n-nodes-sshv2` | 8254 | 2025-08-23 | 2 N8N ( Node & AI Agent Tool) for SSH operations Dynamically Configurable parameters NO credentials,... |
| `@blotato/n8n-nodes-blotato` | 4232 | 2026-01-29 | Official n8n Blotato node |
| `n8n-nodes-upload-post` | 67067 | 2026-05-18 | n8n community node for Upload Post |
| `@gotohuman/n8n-nodes-gotohuman` | 677 | 2026-05-18 | n8n node to request human reviews in AI workflows with gotoHuman |
| `n8n-nodes-pushinator` | 131 | 2025-12-14 | n8n Pushinator integration |
| `@igabm/n8n-nodes-tiktok` | 258 | 2025-08-18 | n8n nodes for implementation for TikTok API |
| `n8n-nodes-htmlcsstoimage` | 10448 | 2026-03-06 | n8n node to convert html css to image |
| `n8n-nodes-aimlapi` | 5137 | 2026-01-12 | Custom n8n node for integrating with the AI/ML API platform (AIMLAPI) to interact with LLMs and mult... |
| `n8n-nodes-cloudinary` | 2682 | 2026-01-11 | The official Cloudinary n8n node - upload media, update asset tags and metadata, and more |
