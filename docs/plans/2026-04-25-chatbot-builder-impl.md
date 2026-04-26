# AI Chatbot Builder — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Google Sheets Add-on that lets non-technical users configure, test, and deploy an AI chatbot widget to any website in 4 simple steps.

**Architecture:** Monolithic Apps Script — all backend, sidebar UI, and widget JS live inside a single Google Apps Script project. No external hosting. Widget communicates with Apps Script Web App for AI responses.

**Tech Stack:** Google Apps Script, HTML Service, Vanilla JS, OpenAI-compatible API format (normalized across providers)

---

## Task 1: Project Scaffold + Manifest

**Files:**
- Create: `appsscript.json`
- Create: `Code.gs`

**Step 1: Create manifest**

```json
{
  "timeZone": "America/New_York",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

**Step 2: Create Code.gs with menu + onOpen**

```javascript
// Code.gs — Menu, sidebar, config CRUD, logging

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Chatbot Builder')
    .addItem('Open', 'openSidebar')
    .addToUi();
}

function openSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Chatbot Builder')
    .setWidth(350);
  SpreadsheetApp.getUi().showSidebar(html);
}
```

**Step 3: Commit**

```bash
git add appsscript.json Code.gs
git commit -m "feat: scaffold project with manifest and menu"
```

---

## Task 2: Config Storage Layer

**Files:**
- Modify: `Code.gs`

**Step 1: Add config CRUD functions**

Add these functions to `Code.gs`:

```javascript
// --- Config CRUD ---

var CONFIG_DEFAULTS = {
  provider: 'openai',
  model: 'gpt-4.1-mini',
  apiKey: '',
  customBaseUrl: '',
  systemPrompt: 'You are a helpful assistant.',
  botName: 'Assistant',
  botColor: '#3B82F6',
  temperature: 0.7,
  maxTokens: 1024,
  topP: 1.0
};

function getConfig() {
  var props = PropertiesService.getDocumentProperties();
  var config = {};
  for (var key in CONFIG_DEFAULTS) {
    var val = props.getProperty(key);
    config[key] = val !== null ? val : CONFIG_DEFAULTS[key];
  }
  return config;
}

function saveConfig(config) {
  var props = PropertiesService.getDocumentProperties();
  for (var key in config) {
    if (config[key] !== undefined && config[key] !== null) {
      props.setProperty(key, String(config[key]));
    }
  }
  return { success: true };
}

function resetConfig() {
  var props = PropertiesService.getDocumentProperties();
  props.deleteAllProperties();
  return { success: true, config: CONFIG_DEFAULTS };
}
```

**Step 2: Commit**

```bash
git add Code.gs
git commit -m "feat: add config CRUD with PropertiesService storage"
```

---

## Task 3: ChatbotConfig Sheet Auto-Generation

**Files:**
- Modify: `Code.gs`

**Step 1: Add sheet init function**

```javascript
// --- Settings Sheet ---

function ensureConfigSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('ChatbotConfig');
  if (!sheet) {
    sheet = ss.insertSheet('ChatbotConfig');
    sheet.hideSheet();
    var headers = ['Key', 'Value'];
    sheet.getRange(1, 1, 1, 2).setValues([headers]);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
    var defaults = [];
    for (var key in CONFIG_DEFAULTS) {
      defaults.push([key, String(CONFIG_DEFAULTS[key])]);
    }
    if (defaults.length > 0) {
      sheet.getRange(2, 1, defaults.length, 2).setValues(defaults);
    }
  }
  return sheet;
}
```

Call `ensureConfigSheet()` inside `onOpen()`.

**Step 2: Commit**

```bash
git add Code.gs
git commit -m "feat: auto-generate hidden ChatbotConfig sheet"
```

---

## Task 4: Provider Registry

**Files:**
- Create: `Providers.gs`

**Step 1: Create Providers.gs with all 10 providers + custom**

```javascript
// Providers.gs — AI provider registry + call logic

var PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'openai'  // openai | anthropic | gemini
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'],
    authHeader: 'x-api-key',
    authPrefix: '',
    bodyFormat: 'anthropic',
    extraHeaders: { 'anthropic-version': '2023-06-01' }
  },
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}',
    models: ['gemini-2.5-pro-preview-05-06', 'gemini-2.5-flash-preview-05-20'],
    authHeader: null,
    authPrefix: '',
    bodyFormat: 'gemini'
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    models: ['openai/gpt-4.1', 'anthropic/claude-sonnet-4-20250514', 'google/gemini-2.5-flash-preview-05-20', 'meta-llama/llama-4-maverick'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'openai'
  },
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'openai'
  },
  mistral: {
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1/chat/completions',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'openai'
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'openai'
  },
  cohere: {
    name: 'Cohere',
    baseUrl: 'https://api.cohere.ai/v2/chat',
    models: ['command-r-plus', 'command-r'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'cohere'
  },
  together: {
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1/chat/completions',
    models: ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'openai'
  },
  fireworks: {
    name: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1/chat/completions',
    models: ['accounts/fireworks/models/llama-v3p1-70b-instruct'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'openai'
  },
  custom: {
    name: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    models: [],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'openai'
  }
};

function getProviders() {
  var result = {};
  for (var key in PROVIDERS) {
    result[key] = { name: PROVIDERS[key].name, models: PROVIDERS[key].models };
  }
  return result;
}
```

**Step 2: Commit**

```bash
git add Providers.gs
git commit -m "feat: add provider registry with 10 providers + custom"
```

---

## Task 5: AI API Call Logic

**Files:**
- Modify: `Providers.gs`

**Step 1: Add callProvider function**

Add to `Providers.gs`:

```javascript
function callAI(config, message, history) {
  var providerKey = config.provider || 'openai';
  var provider = PROVIDERS[providerKey];
  if (!provider) throw new Error('Unknown provider: ' + providerKey);

  var apiKey = config.apiKey;
  var model = config.model || 'gpt-4.1-mini';

  // Build messages array
  var messages = [];
  messages.push({ role: 'system', content: config.systemPrompt || 'You are a helpful assistant.' });
  if (history && history.length > 0) {
    for (var i = 0; i < history.length; i++) {
      messages.push(history[i]);
    }
  }
  messages.push({ role: 'user', content: message });

  var url = provider.baseUrl;
  var options = { method: 'post', muteHttpExceptions: true };

  // Handle different body formats
  if (provider.bodyFormat === 'openai') {
    options.contentType = 'application/json';
    options.payload = JSON.stringify({
      model: model,
      messages: messages,
      temperature: parseFloat(config.temperature) || 0.7,
      max_tokens: parseInt(config.maxTokens) || 1024,
      top_p: parseFloat(config.topP) || 1.0
    });
  } else if (provider.bodyFormat === 'anthropic') {
    options.contentType = 'application/json';
    // Anthropic uses system as top-level param
    var anthropicMessages = messages.filter(function(m) { return m.role !== 'system'; });
    options.payload = JSON.stringify({
      model: model,
      max_tokens: parseInt(config.maxTokens) || 1024,
      system: config.systemPrompt || 'You are a helpful assistant.',
      messages: anthropicMessages
    });
  } else if (provider.bodyFormat === 'gemini') {
    url = provider.baseUrl.replace('{model}', model).replace('{apiKey}', apiKey);
    options.method = 'post';
    options.contentType = 'application/json';
    var geminiContents = [];
    for (var j = 0; j < messages.length; j++) {
      if (messages[j].role === 'system') continue;
      geminiContents.push({
        role: messages[j].role === 'assistant' ? 'model' : 'user',
        parts: [{ text: messages[j].content }]
      });
    }
    geminiContents.push({ role: 'user', parts: [{ text: message }] });
    options.payload = JSON.stringify({
      contents: geminiContents,
      systemInstruction: { parts: [{ text: config.systemPrompt || 'You are a helpful assistant.' }] },
      generationConfig: {
        temperature: parseFloat(config.temperature) || 0.7,
        maxOutputTokens: parseInt(config.maxTokens) || 1024,
        topP: parseFloat(config.topP) || 1.0
      }
    });
    // Gemini uses URL param auth, no header needed
    options.headers = { 'Content-Type': 'application/json' };
    var geminiResponse = UrlFetchApp.fetch(url, options);
    var geminiData = JSON.parse(geminiResponse.getContentText());
    return {
      response: geminiData.candidates[0].content.parts[0].text,
      model: model
    };
  }

  // Set auth headers (non-Gemini)
  options.headers = {};
  if (provider.authHeader && apiKey) {
    options.headers[provider.authHeader] = provider.authPrefix + apiKey;
  }
  if (provider.extraHeaders) {
    for (var eh in provider.extraHeaders) {
      options.headers[eh] = provider.extraHeaders[eh];
    }
  }

  // Handle custom provider URL
  if (providerKey === 'custom' && config.customBaseUrl) {
    url = config.customBaseUrl;
  }

  var response = UrlFetchApp.fetch(url, options);
  var data = JSON.parse(response.getContentText());

  // Parse response based on format
  if (provider.bodyFormat === 'anthropic') {
    return { response: data.content[0].text, model: model };
  } else if (provider.bodyFormat === 'cohere') {
    return { response: data.message.content[0].text, model: model };
  } else {
    // OpenAI-compatible format
    return { response: data.choices[0].message.content, model: model };
  }
}
```

**Step 2: Commit**

```bash
git add Providers.gs
git commit -m "feat: add AI API call logic with multi-format support"
```

---

## Task 6: Chat Handler + Logging

**Files:**
- Modify: `Code.gs`

**Step 1: Add chat handler and logging**

```javascript
// --- Chat Handler ---

function handleChat(message, history) {
  var config = getConfig();
  if (!config.apiKey) {
    return { error: 'Please set your API key in the Setup tab.' };
  }

  var startTime = new Date().getTime();
  try {
    var result = callAI(config, message, history);
    var latency = new Date().getTime() - startTime;
    logConversation(message, result.response, result.model, latency);
    return { response: result.response };
  } catch (e) {
    return { error: 'AI Error: ' + e.message };
  }
}

// --- Logging ---

function ensureLogsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('ChatbotLogs');
  if (!sheet) {
    sheet = ss.insertSheet('ChatbotLogs');
    sheet.hideSheet();
    var headers = ['Timestamp', 'Session ID', 'User Message', 'AI Response', 'Model', 'Latency (ms)'];
    sheet.getRange(1, 1, 1, 6).setValues([headers]);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function logConversation(userMsg, aiResponse, model, latency) {
  var sheet = ensureLogsSheet();
  var sessionId = Utilities.getUuid().substring(0, 8);
  sheet.appendRow([
    new Date().toISOString(),
    sessionId,
    userMsg,
    aiResponse,
    model,
    latency
  ]);
}
```

**Step 2: Commit**

```bash
git add Code.gs
git commit -m "feat: add chat handler with conversation logging"
```

---

## Task 7: Sidebar HTML — Skeleton + Tab Navigation

**Files:**
- Create: `Sidebar.html`

**Step 1: Create Sidebar.html with tab structure and CSS**

Create the file with:
- `<style>` block with full CSS for tabs, forms, chat bubbles, buttons
- Tab navigation bar (Setup | Test | Deploy)
- Three `<div>` tab panels with `display:none` toggling
- `<script>` block with tab switching logic and `google.script.run` calls

The sidebar should be a single HTML file using HTML Service. All CSS inline in `<style>`, all JS inline in `<script>`.

Key CSS principles:
- Clean, modern look with the primary color `#3B82F6`
- Light background (`#F9FAFB`)
- Rounded cards with subtle shadows
- Smooth transitions on tab switch
- Message bubbles: user right-aligned (primary color bg, white text), bot left-aligned (gray bg)
- Responsive within 350px sidebar width

**Step 2: Commit**

```bash
git add Sidebar.html
git commit -m "feat: add sidebar HTML skeleton with tab navigation and styling"
```

---

## Task 8: Sidebar — Setup Tab

**Files:**
- Modify: `Sidebar.html`

**Step 1: Add Setup tab content**

Inside the setup tab panel, add:

1. **Provider section**: dropdown with all 10 providers + Custom
2. **Model section**: dropdown (auto-populated via `getProviders()`), editable text input for custom models
3. **API Key section**: password input + eye toggle
4. **System Prompt section**: textarea with live character counter, 3 template chips ("Customer Support", "FAQ Bot", "Personal Assistant") that fill the textarea on click
5. **Bot Name section**: text input
6. **Color section**: 6 color swatches (Blue, Green, Purple, Red, Orange, Teal)
7. **Advanced Settings**: collapsed `<details>` with temperature slider (0-2, step 0.1), max tokens input, top-p slider (0-1, step 0.1)
8. **Save Config button**: calls `google.script.run.saveConfig()`

JS logic:
- On load: `google.script.run.getConfig().then(populateForm)`
- On provider change: populate model dropdown from `PROVIDERS` data
- Template chips: onclick fills textarea + updates counter
- Save: serialize form to config object, call `google.script.run.saveConfig(config)`

**Step 2: Commit**

```bash
git add Sidebar.html
git commit -m "feat: add Setup tab with provider/model/prompt config UI"
```

---

## Task 9: Sidebar — Test Chat Tab

**Files:**
- Modify: `Sidebar.html`

**Step 1: Add Test Chat tab content**

Inside the test tab panel, add:

1. **Header**: shows current model name
2. **Chat messages area**: scrollable div, message bubbles rendered dynamically
3. **Input area**: text input + send button
4. **Action buttons**: "Clear Chat" and "Reset to Defaults"

JS logic:
- On send: append user bubble, call `google.script.run.handleChat(message, history)`
- On response: append bot bubble, update history array
- "Clear Chat": empty the messages div and history array
- "Reset to Defaults": call `google.script.run.resetConfig()`, repopulate setup form

**Step 2: Commit**

```bash
git add Sidebar.html
git commit -m "feat: add Test Chat tab with live chat testing"
```

---

## Task 10: Sidebar — Deploy Tab

**Files:**
- Modify: `Sidebar.html`

**Step 1: Add Deploy tab content**

Inside the deploy tab panel, add:

1. **Generate Embed Code button**: triggers code generation
2. **Code block**: `<pre><code>` showing the `<script>` tag, with copy-to-clipboard button
3. **Widget preview**: a small mockup iframe or div showing how the widget looks
4. **Deployment info**: shows the web app URL, instructions for deploying

JS logic:
- On "Generate": call `google.script.run.getEmbedCode()`, display in code block
- Copy button: `navigator.clipboard.writeText(code)`
- Preview: render a mini version of the widget with user's chosen color and name

**Step 2: Add getEmbedCode to Code.gs**

```javascript
function getEmbedCode() {
  var deploymentId = ScriptApp.getService().getUrl();
  return '<script src="' + deploymentId + '?widget=true"></script>';
}
```

**Step 3: Commit**

```bash
git add Sidebar.html Code.gs
git commit -m "feat: add Deploy tab with embed code generation"
```

---

## Task 11: WebApp Backend (doGet + doPost)

**Files:**
- Create: `WebApp.gs`

**Step 1: Create WebApp.gs with CORS helper**

```javascript
// WebApp.gs — Web app endpoints for widget

function corsResponse(content) {
  return ContentService.createTextOutput(JSON.stringify(content))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (e.parameter && e.parameter.widget === 'true') {
    return serveWidget();
  }
  // Status page
  var config = getConfig();
  var html = '<!DOCTYPE html><html><head><title>Chatbot Builder</title></head><body>';
  html += '<h1>Chatbot Builder API</h1>';
  html += '<p>Bot: ' + (config.botName || 'Assistant') + '</p>';
  html += '<p>Status: Active</p>';
  html += '<p>Deploy your widget using the embed code from the sidebar.</p>';
  html += '</body></html>';
  return HtmlService.createHtmlOutput(html);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var message = body.message;
    var history = body.history || [];

    var config = getConfig();
    var result = callAI(config, message, history);

    var startTime = new Date().getTime();
    var latency = new Date().getTime() - startTime;
    logConversation(message, result.response, result.model, latency);

    return corsResponse({ response: result.response });
  } catch (err) {
    return corsResponse({ error: err.message });
  }
}
```

**Step 2: Commit**

```bash
git add WebApp.gs
git commit -m "feat: add WebApp doGet/doPost endpoints with CORS"
```

---

## Task 12: Embeddable Widget JS

**Files:**
- Modify: `WebApp.gs` (add `serveWidget()` function)

**Step 1: Add serveWidget function to WebApp.gs**

```javascript
function serveWidget() {
  var config = getConfig();
  var widgetJs = buildWidgetJS(config);
  return ContentService.createTextOutput(widgetJs)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function buildWidgetJS(config) {
  var c = {
    botName: config.botName || 'Assistant',
    botColor: config.botColor || '#3B82F6',
    endpoint: ScriptApp.getService().getUrl()
  };
  // Widget JS is built as a template string
  return '(function(){' +
    'var C=' + JSON.stringify(c) + ';' +
    'var d=document.createElement("div");d.id="chatbot-widget";' +
    // ... full widget JS injected here (see Task 13)
    'document.body.appendChild(d);' +
    '})();';
}
```

**Step 2: Commit**

```bash
git add WebApp.gs
git commit -m "feat: add widget JS server via doGet"
```

---

## Task 13: Full Widget JS Implementation

**Files:**
- Modify: `WebApp.gs` (expand `buildWidgetJS`)

**Step 1: Implement the full self-contained widget**

The widget JS (injected as string in `buildWidgetJS`) must:

1. **Create floating chat bubble** — bottom-right fixed position, user's color, click to toggle
2. **Create chat panel** — positioned above bubble, includes:
   - Header with bot name + close button
   - Messages container (scrollable)
   - Input field + send button
3. **Chat logic:**
   - On send: POST to endpoint with `{ message, history }`
   - Display typing indicator while waiting
   - Append response as bot bubble
   - Store history in `sessionStorage`
4. **Auto dark/light mode**: check `window.matchMedia('(prefers-color-scheme: dark)')`
5. **Mobile responsive**: adjust width/position on small screens

CSS injected inline via JS. No external dependencies.

The full widget code will be ~200-300 lines of vanilla JS written as a string template in `buildWidgetJS()`.

**Step 2: Commit**

```bash
git add WebApp.gs
git commit -m "feat: implement full embeddable widget with chat UI"
```

---

## Task 14: Integration + Polish

**Files:**
- Modify: all files as needed

**Step 1: Wire everything together**

- Verify `onOpen()` calls `ensureConfigSheet()`
- Verify sidebar loads config on open
- Verify chat tab calls `handleChat()` correctly
- Verify deploy tab generates correct embed code
- Verify widget JS renders and connects to endpoint

**Step 2: Error handling polish**

- Add loading spinners in sidebar for async calls
- Show toast notifications on save/error
- Handle empty API key gracefully
- Handle network errors in widget

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: integration polish and error handling"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Project scaffold + manifest | `appsscript.json`, `Code.gs` |
| 2 | Config storage layer | `Code.gs` |
| 3 | ChatbotConfig sheet | `Code.gs` |
| 4 | Provider registry | `Providers.gs` |
| 5 | AI API call logic | `Providers.gs` |
| 6 | Chat handler + logging | `Code.gs` |
| 7 | Sidebar skeleton + tabs | `Sidebar.html` |
| 8 | Setup tab | `Sidebar.html` |
| 9 | Test chat tab | `Sidebar.html` |
| 10 | Deploy tab | `Sidebar.html`, `Code.gs` |
| 11 | WebApp endpoints | `WebApp.gs` |
| 12 | Widget JS server | `WebApp.gs` |
| 13 | Full widget implementation | `WebApp.gs` |
| 14 | Integration + polish | All files |
