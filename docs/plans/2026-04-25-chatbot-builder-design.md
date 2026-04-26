# AI Chatbot Builder — Google Sheets Add-on

## Overview

A Google Sheets Add-on that lets non-technical users configure, test, and deploy a customizable AI chatbot widget to any website in 4 steps.

**Target user:** Non-technical creators (bloggers, small business owners, vibe-coders).

## Architecture

**Approach:** Monolithic Apps Script — everything runs inside Google Apps Script. No external hosting.

```
[Sidebar] → google.script.run → [Code.gs] → PropertiesService (config)
                                                    ↓
[Website Widget] → fetch(/exec) → [WebApp.gs doPost] → [Providers.gs] → AI API
                                                    ↓
                                              [Logs Sheet]
```

## Project Structure

```
chatbot-builder/
├── Code.gs               — Menu, sidebar open, config CRUD, logging
├── WebApp.gs             — doGet (serves widget JS), doPost (chat API)
├── Providers.gs          — AI provider registry + call logic
├── Sidebar.html          — Single-page sidebar UI (tabs: Setup, Test, Deploy)
├── Widget.js             — Self-contained embeddable widget (served via doGet)
└── appsscript.json       — Manifest
```

## User Flow (4 Steps)

1. **Setup**: Pick provider → pick model → paste API key
2. **Customize**: Write system prompt (with starter templates) + set bot name + pick color
3. **Test**: Chat with bot in sidebar to verify behavior
4. **Deploy**: Copy `<script>` tag, paste into any website

## Provider System

Built-in providers with pre-configured endpoints:

| Provider | Base URL | Example Models |
|----------|----------|----------------|
| OpenAI | api.openai.com/v1 | GPT-4.1, GPT-4.1-mini, GPT-4.1-nano |
| Anthropic | api.anthropic.com/v1 | Claude Sonnet 4, Claude Haiku 4.5 |
| Google Gemini | generativelanguage.googleapis.com | Gemini 2.5 Pro, Gemini 2.5 Flash |
| OpenRouter | openrouter.ai/api/v1 | 100+ models via single key |
| Groq | api.groq.com/openai/v1 | Llama, Mixtral |
| Mistral | api.mistral.ai/v1 | Mistral Large, Medium, Small |
| DeepSeek | api.deepseek.com/v1 | DeepSeek-V3, DeepSeek-R1 |
| Cohere | api.cohere.ai/v2 | Command R+ |
| Together AI | api.together.xyz/v1 | Open-source models |
| Fireworks AI | api.fireworks.ai/inference/v1 | Fast open-source inference |

**Custom provider**: User enters base URL + API key + model name (covers any OpenAI-compatible endpoint).

All providers normalize to a common format internally.

## Sidebar UI

**3-tab layout:**

### Tab 1 — Setup
- Provider dropdown (with "Custom" at bottom)
- Model dropdown (auto-populates based on provider, editable for custom)
- API key field (password input, saved to PropertiesService)
- System prompt textarea with character counter
- 3 starter template chips: "Customer Support", "FAQ Bot", "Personal Assistant"
- Bot name field
- Color picker (5-6 preset swatches)
- "Advanced Settings" collapsed toggle (temperature, max tokens, top-p)

### Tab 2 — Test Chat
- Chat interface with message bubbles
- Tests against saved config
- "Clear Chat" button
- Shows model being used

### Tab 3 — Deploy
- "Generate Embed Code" button
- Copy-to-clipboard code block with `<script>` tag
- Preview of widget appearance
- Deployment URL for reference

**Menu**: Extensions > Chatbot Builder > Open

## Embeddable Widget

- Floating chat bubble (bottom-right), user's chosen color
- Click expands to chat panel (bot name, avatar, messages, input)
- Typing indicator while waiting for response
- Light/dark mode (auto-detects from host page)
- Mobile responsive
- Fully self-contained, no external dependencies
- Conversation state in sessionStorage (survives refresh, clears on tab close)

**Script tag format:**
```html
<script src="https://script.google.com/.../exec" data-chatbot="abc123"></script>
```

## Backend

### Endpoints
- `doGet` — serves widget JS with config baked in
- `doPost` — receives `{ message, history[] }`, injects system prompt, calls AI provider, returns `{ response }`

### Logging
- Auto-creates hidden "ChatbotLogs" sheet
- Columns: timestamp, session ID, user message, AI response, model, tokens used, latency

### Security
- API keys in PropertiesService.getScriptProperties()
- CORS headers on all responses
- Rate limiting: 60 requests/minute per session
- No PII collected

## Smart Defaults

| Setting | Default | Reason |
|---------|---------|--------|
| Temperature | 0.7 | Good balance of creative/focused |
| Max tokens | 1024 | Sufficient for most responses |
| Top-P | 1 | Standard default |
| Model | GPT-4.1-mini | Best value/quality ratio |
| System prompt | "You are a helpful assistant." | Safe starting point |
| Bot name | "Assistant" | Universal |
| Color | Blue (#3B82F6) | Clean, professional |

## Tech Stack

- Google Apps Script (backend + sidebar)
- HTML Service (sidebar UI)
- Vanilla JS (embeddable widget)
- OpenAI-compatible API format (normalized across providers)
