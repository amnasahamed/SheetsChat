# Marketplace Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the AI Chatbot Builder for Google Workspace Marketplace launch by adding security, UX polish, and marketplace-required assets.

**Architecture:** All changes stay within the existing monolithic Apps Script structure. Security logic goes in WebApp.gs (rate limiting, input validation) and Code.gs (API key migration). UX changes are confined to Sidebar.html. Marketplace docs are static HTML files.

**Tech Stack:** Google Apps Script (ES5), HTML Service, CacheService for rate limiting

---

## Task 1: Rate Limiting via CacheService

**Files:**
- Modify: `WebApp.gs:23-41` (doPost function)

**Step 1: Add rate limiting helper function**

Add the following function at the end of `WebApp.gs` (after `buildWidgetJS`):

```javascript
/**
 * Rate limiting using CacheService.
 * Returns true if request is allowed, false if rate limited.
 * Limit: 30 requests per sessionId per 60 seconds.
 */
function checkRateLimit(sessionId) {
  if (!sessionId) sessionId = 'anonymous';
  var cacheKey = 'rl_' + sessionId;
  var cache = CacheService.getScriptCache();
  var countStr = cache.get(cacheKey);
  var count = countStr ? parseInt(countStr, 10) : 0;
  if (count >= 30) {
    return false;
  }
  cache.put(cacheKey, String(count + 1), 60);
  return true;
}
```

**Step 2: Add rate limit check to doPost**

Replace the existing `doPost` function (WebApp.gs:23-41) with:

```javascript
function doPost(e) {
  try {
    // Rate limit by session (use IP-like identifier from postData)
    var sessionId = 'anon';
    try {
      var preBody = JSON.parse(e.postData.contents);
      sessionId = preBody.sessionId || preBody.session_id || 'anon';
    } catch (err) { /* use default */ }

    if (!checkRateLimit(sessionId)) {
      return corsResponse({ error: 'Rate limited. Please wait a moment and try again.' });
    }

    var body = JSON.parse(e.postData.contents);

    // Route: lead capture
    if (body.type === 'lead') {
      var result = saveLead(body);
      return corsResponse(result);
    }

    // Route: chat message — validate inputs
    if (!body.message || typeof body.message !== 'string') {
      return corsResponse({ error: 'Message is required.' });
    }
    if (body.message.length > 4000) {
      return corsResponse({ error: 'Message too long (max 4000 characters).' });
    }

    // Sanitize history
    var history = [];
    if (body.history && Array.isArray(body.history)) {
      for (var i = 0; i < Math.min(body.history.length, 20); i++) {
        var h = body.history[i];
        if (h && typeof h.content === 'string' && h.content.length <= 2000) {
          history.push({ role: String(h.role), content: h.content });
        }
      }
    }

    var chatResult = handleChat(body.message, history);
    return corsResponse(chatResult);
  } catch (err) {
    return corsResponse({ error: err.message || 'Server error.' });
  }
}
```

**Step 3: Commit**

```bash
git add WebApp.gs
git commit -m "feat: add rate limiting and input validation to doPost"
```

---

## Task 2: Sanitize User Input (XSS Prevention)

**Files:**
- Modify: `Code.gs:81-102` (handleChat function)

**Step 1: Add HTML sanitization helper**

Add at the end of `Code.gs` (after `saveLead`):

```javascript
/**
 * Strips HTML tags from a string to prevent injection.
 */
function sanitizeHtml(text) {
  return text.replace(/<[^>]*>/g, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
}
```

**Step 2: Apply sanitization in handleChat**

In `Code.gs`, update `handleChat` to sanitize the message before passing to AI:

```javascript
function handleChat(message, history) {
  var config = getConfig();
  if (!config.apiKey) {
    return { error: 'Please set your API key in the Setup tab.' };
  }

  // Sanitize user message
  message = sanitizeHtml(message);

  // Inject knowledge base context into system prompt
  var kbContext = getKnowledgeContext(message);
  if (kbContext) {
    config.systemPrompt = (config.systemPrompt || '') + kbContext;
  }

  var startTime = new Date().getTime();
  try {
    var result = callAI(config, message, history);
    var latency = new Date().getTime() - startTime;
    logConversation(message, result.response, result.model, latency);
    return { response: result.response };
  } catch (e) {
    // Parse common error codes for user-friendly messages
    var errMsg = e.message || '';
    if (errMsg.indexOf('401') !== -1) {
      return { error: 'Invalid API key. Check your key in the Setup tab.' };
    }
    if (errMsg.indexOf('429') !== -1) {
      return { error: 'Rate limited by AI provider. Wait a moment and try again.' };
    }
    return { error: 'AI Error: ' + errMsg };
  }
}
```

**Step 3: Commit**

```bash
git add Code.gs
git commit -m "feat: add input sanitization and friendly error messages"
```

---

## Task 3: Move API Key to ScriptProperties

**Files:**
- Modify: `Code.gs:34-52` (getConfig/saveConfig functions)

**Step 1: Update getConfig to use ScriptProperties for API key**

Replace the `getConfig` function (Code.gs:34-42):

```javascript
function getConfig() {
  var props = PropertiesService.getDocumentProperties();
  var scriptProps = PropertiesService.getScriptProperties();
  var config = {};
  for (var key in CONFIG_DEFAULTS) {
    var val = props.getProperty(key);
    config[key] = val !== null ? val : CONFIG_DEFAULTS[key];
  }
  // API key comes from ScriptProperties (more secure)
  var apiKey = scriptProps.getProperty('apiKey');
  if (apiKey) {
    config.apiKey = apiKey;
  }
  return config;
}
```

**Step 2: Update saveConfig to store API key in ScriptProperties**

Replace the `saveConfig` function (Code.gs:44-52):

```javascript
function saveConfig(config) {
  var props = PropertiesService.getDocumentProperties();
  var scriptProps = PropertiesService.getScriptProperties();

  // Store API key in ScriptProperties (not accessible by sheet users)
  if (config.apiKey !== undefined && config.apiKey !== null) {
    scriptProps.setProperty('apiKey', String(config.apiKey));
  }

  // Store everything else in DocumentProperties
  for (var key in config) {
    if (key === 'apiKey') continue; // already handled
    if (config[key] !== undefined && config[key] !== null) {
      props.setProperty(key, String(config[key]));
    }
  }
  return { success: true };
}
```

**Step 3: Update resetConfig to clear both stores**

Replace `resetConfig` (Code.gs:54-58):

```javascript
function resetConfig() {
  var props = PropertiesService.getDocumentProperties();
  var scriptProps = PropertiesService.getScriptProperties();
  props.deleteAllProperties();
  scriptProps.deleteProperty('apiKey');
  return { success: true, config: CONFIG_DEFAULTS };
}
```

**Step 4: Add migration for existing users**

Add to `onOpen` in Code.gs, after the existing `ensureConfigSheet()` call:

```javascript
// Migrate API key from DocumentProperties to ScriptProperties (one-time)
var docProps = PropertiesService.getDocumentProperties();
var scriptProps = PropertiesService.getScriptProperties();
var oldKey = docProps.getProperty('apiKey');
if (oldKey && !scriptProps.getProperty('apiKey')) {
  scriptProps.setProperty('apiKey', oldKey);
  docProps.deleteProperty('apiKey');
}
```

**Step 5: Update Sidebar.html to mask API key on load**

In `Sidebar.html`, update `populateForm` to mask the API key display. Replace line 914:

```javascript
      document.getElementById('apiKey').value = config.apiKey || '';
```

With:

```javascript
      // Show masked API key — user must re-enter to change
      var apiKeyInput = document.getElementById('apiKey');
      if (config.apiKey) {
        apiKeyInput.value = config.apiKey.substring(0, 4) + '...' + config.apiKey.substring(config.apiKey.length - 4);
        apiKeyInput.setAttribute('data-masked', 'true');
      } else {
        apiKeyInput.value = '';
        apiKeyInput.removeAttribute('data-masked');
      }
```

Update `saveConfig` in Sidebar.html to handle masked keys. In the config object (around line 1026), replace:

```javascript
        apiKey: document.getElementById('apiKey').value,
```

With:

```javascript
        apiKey: document.getElementById('apiKey').getAttribute('data-masked') ? undefined : document.getElementById('apiKey').value,
```

**Step 6: Commit**

```bash
git add Code.gs Sidebar.html
git commit -m "feat: move API key to ScriptProperties for better security"
```

---

## Task 4: Widget Error Recovery (Retry Button)

**Files:**
- Modify: `WebApp.gs` (inside `buildWidgetJS`)

**Step 1: Add retry button to error messages in widget**

In the widget JS (inside `buildWidgetJS`), find the `appendMsg` function and update the error branch. Locate:

```javascript
'if(role==="error"){b.className="cb-err";b.textContent=text;}'
```

Replace with:

```javascript
'if(role==="error"){b.className="cb-err";b.textContent=text;' +
'var rb=D.createElement("button");rb.textContent="Retry";rb.style.cssText="margin-top:6px;padding:4px 12px;border:1px solid #D1D5DB;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;font-family:system-ui;";' +
'rb.addEventListener("click",function(){b.remove();inp.value=H.length>0?H[H.length-1].content:"";if(inp.value)send();});' +
'b.appendChild(rb);}'
```

**Step 2: Commit**

```bash
git add WebApp.gs
git commit -m "feat: add retry button to widget error messages"
```

---

## Task 5: First-Run Welcome Banner

**Files:**
- Modify: `Sidebar.html` (Setup tab HTML + JS)

**Step 1: Add welcome banner HTML**

In `Sidebar.html`, insert the following right after `<div id="tab-setup" class="tab-content active">` and before the first form-group:

```html
    <div id="welcomeBanner" style="display:none; background:linear-gradient(135deg,#EEF2FF,#E0E7FF); border:1px solid #C7D2FE; border-radius:10px; padding:14px; margin-bottom:16px;">
      <div style="font-size:14px; font-weight:700; color:#4338CA; margin-bottom:6px;">Welcome to Chatbot Builder!</div>
      <p style="font-size:12px; color:#4338CA; opacity:0.8; line-height:1.6;">Set up your AI chatbot in 3 steps:</p>
      <ol style="font-size:12px; color:#4338CA; opacity:0.8; line-height:1.8; padding-left:20px;">
        <li>Pick a provider and paste your <strong>API key</strong></li>
        <li>Customize your bot's name and behavior</li>
        <li>Click <strong>Deploy</strong> to get your embed code</li>
      </ol>
      <button onclick="dismissWelcome()" style="margin-top:8px; padding:6px 12px; background:#4338CA; color:#fff; border:none; border-radius:6px; font-size:12px; cursor:pointer; font-weight:600;">Got it, let's go!</button>
    </div>
```

**Step 2: Add dismissWelcome function**

In the `<script>` section, add:

```javascript
    function dismissWelcome() {
      document.getElementById('welcomeBanner').style.display = 'none';
      try { localStorage.setItem('cb_welcome_dismissed', '1'); } catch(e) {}
    }
```

**Step 3: Show banner on first run**

In `populateForm`, add at the end of the function (before the closing `}`):

```javascript
      // Show welcome banner if no API key saved yet
      var showWelcome = !config.apiKey;
      try { showWelcome = showWelcome && !localStorage.getItem('cb_welcome_dismissed'); } catch(e) {}
      document.getElementById('welcomeBanner').style.display = showWelcome ? 'block' : 'none';
```

**Step 4: Commit**

```bash
git add Sidebar.html
git commit -m "feat: add first-run welcome banner for new users"
```

---

## Task 6: Help Text on Setup Fields

**Files:**
- Modify: `Sidebar.html` (Setup tab HTML)

**Step 1: Add help text below key form fields**

In the Setup tab, add help text after these elements:

After the API Key label (around line 634), change:

```html
      <label for="apiKey">API Key</label>
```

To:

```html
      <label for="apiKey">API Key <a href="https://platform.openai.com/api-keys" target="_blank" style="font-size:10px; font-weight:400; color:#3B82F6; text-decoration:none;">(Where do I get one?)</a></label>
```

In Advanced Settings, after the Temperature label, change:

```html
          <label>Temperature</label>
```

To:

```html
          <label>Temperature <span style="font-size:10px; font-weight:400; color:#9CA3AF;">Higher = creative, Lower = focused</span></label>
```

After Max Tokens label, change:

```html
          <label for="maxTokens">Max Tokens</label>
```

To:

```html
          <label for="maxTokens">Max Tokens <span style="font-size:10px; font-weight:400; color:#9CA3AF;">Max length of AI responses</span></label>
```

After Top P label, change:

```html
          <label>Top P</label>
```

To:

```html
          <label>Top P <span style="font-size:10px; font-weight:400; color:#9CA3AF;">Controls response diversity</span></label>
```

After System Prompt label, add a line after the template chips div:

```html
      <div style="font-size:11px; color:#9CA3AF; margin-bottom:4px;">Instructions that guide how the AI responds to messages.</div>
```

**Step 2: Commit**

```bash
git add Sidebar.html
git commit -m "feat: add help text to setup form fields"
```

---

## Task 7: Deploy Tab Empty State Hint

**Files:**
- Modify: `Sidebar.html` (Deploy tab)

**Step 1: Add save-first hint**

In the Deploy tab, before the first deploy-section div, add:

```html
    <div id="deploySaveHint" style="display:none; background:#FEF3C7; border:1px solid #FCD34D; border-radius:8px; padding:12px; margin-bottom:16px; font-size:12px; color:#92400E;">
      Save your configuration in the <strong>Setup</strong> tab before deploying.
    </div>
```

**Step 2: Show hint when no API key**

In the `switchTab` function, inside the `if (tab === 'deploy')` block, add:

```javascript
        var hasKey = document.getElementById('apiKey').value && !document.getElementById('apiKey').getAttribute('data-masked') || document.getElementById('apiKey').getAttribute('data-masked');
        document.getElementById('deploySaveHint').style.display = hasKey ? 'none' : 'block';
```

**Step 3: Commit**

```bash
git add Sidebar.html
git commit -m "feat: add save-first hint to deploy tab"
```

---

## Task 8: Privacy Policy Page

**Files:**
- Create: `docs/privacy-policy.html`

**Step 1: Create privacy policy HTML file**

Create `docs/privacy-policy.html` with the following content. This is a static page to be hosted on GitHub Pages or similar.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy — AI Chatbot Builder</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 640px; margin: 40px auto; padding: 20px; color: #1F2937; line-height: 1.7; }
    h1 { color: #1E40AF; font-size: 24px; margin-bottom: 8px; }
    h2 { color: #1E40AF; font-size: 18px; margin-top: 32px; }
    p { margin: 12px 0; }
    .updated { color: #6B7280; font-size: 14px; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p class="updated">Last updated: April 26, 2026</p>

  <h2>What Data We Collect</h2>
  <p>AI Chatbot Builder stores the following data within your own Google Sheets spreadsheet:</p>
  <ul>
    <li><strong>Configuration settings</strong> — Provider, model, system prompt, bot name, colors (stored in Google PropertiesService)</li>
    <li><strong>Chat logs</strong> — Timestamp, session ID, user messages, AI responses, model used, latency (stored in a "ChatbotLogs" sheet)</li>
    <li><strong>Lead captures</strong> — Name, email, phone, source (stored in a "Leads" sheet)</li>
    <li><strong>Knowledge base entries</strong> — Category, question, answer, keywords (stored in a "KnowledgeBase" sheet)</li>
    <li><strong>API keys</strong> — Your AI provider API key (stored securely in Google ScriptProperties)</li>
  </ul>

  <h2>How We Store Data</h2>
  <p>All data is stored within your Google Sheets spreadsheet and Google PropertiesService. We do not operate any external servers or databases. Your data remains within your Google account.</p>

  <h2>Third-Party Services</h2>
  <p>When you use this add-on, chat messages are sent to your selected AI provider (e.g., OpenAI, Anthropic, Google Gemini). These providers process your messages according to their own privacy policies:</p>
  <ul>
    <li><a href="https://openai.com/privacy">OpenAI Privacy Policy</a></li>
    <li><a href="https://www.anthropic.com/privacy">Anthropic Privacy Policy</a></li>
    <li><a href="https://policies.google.com/privacy">Google Privacy Policy</a></li>
  </ul>
  <p>We do not intercept, log, or share your messages with any party other than the AI provider you select.</p>

  <h2>Data Sharing</h2>
  <p>We do not sell, share, or transfer your data to any third parties beyond the AI provider you configure.</p>

  <h2>Your Rights</h2>
  <ul>
    <li>Delete chat logs by deleting rows from the "ChatbotLogs" sheet</li>
    <li>Delete leads by deleting rows from the "Leads" sheet</li>
    <li>Delete knowledge base entries by deleting rows from the "KnowledgeBase" sheet</li>
    <li>Remove all data by uninstalling the add-on and deleting the associated sheets</li>
    <li>Reset configuration by using the "Reset to Defaults" button</li>
  </ul>

  <h2>Widget Visitors</h2>
  <p>When visitors use the chat widget on your website:</p>
  <ul>
    <li>Their messages are sent to your configured AI provider to generate responses</li>
    <li>Conversation history is stored in their browser's sessionStorage (cleared when they close the tab)</li>
    <li>If lead capture is enabled, their name and email are stored in your "Leads" sheet</li>
    <li>We do not use cookies or tracking on the widget</li>
  </ul>

  <h2>Security</h2>
  <p>API keys are stored in Google ScriptProperties, which is only accessible by the Apps Script runtime — not by users who open the spreadsheet. We implement rate limiting to prevent abuse of the widget endpoint.</p>

  <h2>Changes</h2>
  <p>We may update this privacy policy from time to time. Changes will be reflected in the "Last updated" date above.</p>

  <h2>Contact</h2>
  <p>For privacy-related questions, please contact the add-on developer through the Google Workspace Marketplace listing.</p>
</body>
</html>
```

**Step 2: Commit**

```bash
git add docs/privacy-policy.html
git commit -m "docs: add privacy policy for marketplace listing"
```

---

## Task 9: Terms of Service Page

**Files:**
- Create: `docs/terms-of-service.html`

**Step 1: Create terms HTML file**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service — AI Chatbot Builder</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 640px; margin: 40px auto; padding: 20px; color: #1F2937; line-height: 1.7; }
    h1 { color: #1E40AF; font-size: 24px; margin-bottom: 8px; }
    h2 { color: #1E40AF; font-size: 18px; margin-top: 32px; }
    p { margin: 12px 0; }
    .updated { color: #6B7280; font-size: 14px; }
  </style>
</head>
<body>
  <h1>Terms of Service</h1>
  <p class="updated">Last updated: April 26, 2026</p>

  <h2>Acceptance</h2>
  <p>By installing and using AI Chatbot Builder ("the Add-on"), you agree to these terms. If you do not agree, do not use the Add-on.</p>

  <h2>Description</h2>
  <p>AI Chatbot Builder is a Google Sheets add-on that lets you configure an AI-powered chatbot widget and embed it on your website. The Add-on connects to third-party AI providers using API keys you provide.</p>

  <h2>Your Responsibilities</h2>
  <ul>
    <li><strong>API Keys:</strong> You are responsible for obtaining and managing your own API keys for AI providers. You are responsible for all costs incurred through your API key usage.</li>
    <li><strong>Content:</strong> You are responsible for the content of your system prompts, knowledge base entries, and how the chatbot is used on your website.</li>
    <li><strong>Compliance:</strong> You must comply with the terms of service of your chosen AI provider, applicable laws, and regulations (including data protection laws like GDPR).</li>
    <li><strong>Widget Visitors:</strong> If you enable lead capture, you are responsible for obtaining proper consent from visitors and handling their data lawfully.</li>
  </ul>

  <h2>Limitation of Liability</h2>
  <p>The Add-on is provided "as is" without warranties of any kind. We are not liable for:</p>
  <ul>
    <li>API costs incurred through your usage</li>
    <li>AI-generated content or responses</li>
    <li>Data loss (your data stays in your Google Sheets)</li>
    <li>Service interruptions by third-party AI providers</li>
    <li>Any indirect, incidental, or consequential damages</li>
  </ul>

  <h2>Data Ownership</h2>
  <p>All data (configuration, chat logs, leads, knowledge base) is stored in your Google Sheets spreadsheet. You retain full ownership and control of your data. We do not have access to your spreadsheet.</p>

  <h2>Modifications</h2>
  <p>We may update these terms from time to time. Continued use of the Add-on after changes constitutes acceptance of the updated terms.</p>

  <h2>Termination</h2>
  <p>You may stop using the Add-on at any time by uninstalling it from your Google Sheets. Upon uninstallation, your data remains in your spreadsheet until you delete it.</p>

  <h2>Contact</h2>
  <p>For questions about these terms, please contact the add-on developer through the Google Workspace Marketplace listing.</p>
</body>
</html>
```

**Step 2: Commit**

```bash
git add docs/terms-of-service.html
git commit -m "docs: add terms of service for marketplace listing"
```

---

## Task 10: Marketplace Store Listing Copy

**Files:**
- Create: `docs/store-listing.md`

**Step 1: Create store listing document**

```markdown
# Google Workspace Marketplace Store Listing

## App Name
AI Chatbot Builder

## Short Description (132 chars max)
Add a customizable AI chatbot to any website in minutes. Supports 10+ AI providers. No coding required.

## Full Description

**AI Chatbot Builder** lets anyone create and deploy a custom AI chatbot widget to their website — directly from Google Sheets.

**How it works:**
1. **Set up** — Pick an AI provider (OpenAI, Anthropic, Google Gemini, and 7+ more), select a model, paste your API key
2. **Customize** — Write your bot's personality, choose a name, pick colors, add a knowledge base
3. **Test** — Chat with your bot right in the sidebar to verify it works
4. **Deploy** — Copy a single line of code and paste it into any website

**Features:**
- 10+ AI providers: OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Mistral, DeepSeek, Cohere, Together AI, Fireworks AI, and custom endpoints
- Customizable chat widget with your brand colors and name
- Knowledge base — add your own Q&A entries so the bot answers from your data
- Lead capture — collect visitor name and email before chat starts
- Suggested questions to guide visitors
- Dark mode support (auto-detects from host website)
- Mobile responsive
- Conversation logging directly in your spreadsheet
- No external hosting needed — everything runs in Google Apps Script
- Works on any website: HTML, WordPress, React, Next.js, Shopify, Wix, Squarespace, and more

**Use cases:**
- Customer support chatbot
- FAQ bot for your business
- Personal assistant widget
- Lead generation tool
- Product recommendation bot

**Your data stays yours.** All configuration, chat logs, and leads are stored in your Google Sheets. We don't run any external servers.

## Category
Productivity

## Language
English

## Screenshots needed (3-5)
1. Setup tab with provider dropdown and API key field
2. Test Chat tab with active conversation
3. Deploy tab with generated embed code and preview
4. Widget on a sample website
5. Knowledge Base tab with entries
```

**Step 2: Commit**

```bash
git add docs/store-listing.md
git commit -m "docs: add marketplace store listing copy"
```

---

## Summary

| Task | Files Changed | Priority |
|------|--------------|----------|
| 1. Rate Limiting | WebApp.gs | CRITICAL |
| 2. Input Sanitization | Code.gs | CRITICAL |
| 3. API Key to ScriptProperties | Code.gs, Sidebar.html | HIGH |
| 4. Widget Retry Button | WebApp.gs | MEDIUM |
| 5. First-Run Banner | Sidebar.html | MEDIUM |
| 6. Help Text | Sidebar.html | MEDIUM |
| 7. Deploy Empty State | Sidebar.html | LOW |
| 8. Privacy Policy | docs/privacy-policy.html | BLOCKER |
| 9. Terms of Service | docs/terms-of-service.html | BLOCKER |
| 10. Store Listing Copy | docs/store-listing.md | BLOCKER |

**Execution order:** Tasks 1-3 (security), then 4-7 (UX), then 8-10 (marketplace docs).
