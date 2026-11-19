/**
 * Simple trigger. In an add-on this can run in AuthMode.NONE (before the user
 * has enabled the add-on in this document), where PropertiesService and sheet
 * writes are not allowed — so it only builds the menu. Sheets are created when
 * the sidebar opens.
 */
function onOpen(e) {
  SpreadsheetApp.getUi()
    .createAddonMenu()
    .addItem('Open Sidebar', 'openSidebar')
    .addToUi();

  if (e && e.authMode === ScriptApp.AuthMode.NONE) return;
  try { migrateApiKeyStorage_(); } catch (err) { /* non-critical */ }
}

function onInstall(e) {
  onOpen(e);
}

/**
 * Simple trigger: drop the cached KB when the KnowledgeBase sheet is edited by hand.
 */
function onEdit(e) {
  try {
    if (e && e.range && e.range.getSheet().getName() === KB_SHEET_NAME) {
      invalidateKBCache_();
    }
  } catch (err) { /* non-critical */ }
}

function openSidebar() {
  ensureKnowledgeSheet();
  ensureLeadsSheet();
  ensureLogsSheet();
  migrateApiKeyStorage_();
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('SheetsChat')
    .setWidth(350);
  SpreadsheetApp.getUi().showSidebar(html);
}

var CONFIG_DEFAULTS = {
  provider: 'openai',
  model: 'gpt-5.2',
  apiKey: '',
  customBaseUrl: '',
  webAppUrl: '',
  systemPrompt: 'You are a helpful assistant.',
  botName: 'Assistant',
  botColor: '#3B82F6',
  temperature: 0.7,
  maxTokens: 1024,
  topP: 1.0,
  welcomeMessage: 'Hello! How can I help you today?',
  suggestedQuestions: '',
  leadCaptureEnabled: 'false',
  allowedDomains: ''
};

var MAX_MESSAGE_LENGTH = 4000;
var MAX_HISTORY_ENTRIES = 20;
var MAX_HISTORY_ENTRY_LENGTH = 2000;

/**
 * The API key lives in DocumentProperties so it is scoped to this spreadsheet.
 *
 * Older versions stored it in ScriptProperties. When this script runs as a
 * Marketplace add-on, ScriptProperties are shared by EVERY install, so a key
 * stored there would be visible to (and used by) other customers. Only a
 * bound / self-deployed copy (InstallationSource.NONE) may migrate it.
 */
function migrateApiKeyStorage_() {
  var docProps = PropertiesService.getDocumentProperties();
  if (!docProps) return;
  var scriptProps = PropertiesService.getScriptProperties();
  var legacyKey = scriptProps.getProperty('apiKey');
  if (!legacyKey) return;

  var source;
  try {
    source = ScriptApp.getInstallationSource();
  } catch (err) {
    return; // can't tell: change nothing (the script copy is no longer read)
  }
  if (source === ScriptApp.InstallationSource.NONE) {
    // Bound / self-deployed copy: script and document scope are the same owner.
    if (!docProps.getProperty('apiKey')) {
      docProps.setProperty('apiKey', legacyKey);
    }
    if (docProps.getProperty('apiKey')) scriptProps.deleteProperty('apiKey');
  } else {
    // Add-on: the shared copy belongs to whoever saved it last. Never copy it.
    scriptProps.deleteProperty('apiKey');
  }
}

function getConfigInternal_() {
  var props = PropertiesService.getDocumentProperties();
  if (!props) {
    throw new Error('SheetsChat must run from a spreadsheet (no document context).');
  }
  var config = {};
  for (var key in CONFIG_DEFAULTS) {
    var val = props.getProperty(key);
    config[key] = val !== null ? val : CONFIG_DEFAULTS[key];
  }
  if (!config.apiKey) {
    // e.g. the widget's first request after upgrading, before the sheet is reopened
    try {
      migrateApiKeyStorage_();
      config.apiKey = props.getProperty('apiKey') || '';
    } catch (err) { /* non-critical */ }
  }
  return config;
}

function getConfig() {
  var config = getConfigInternal_();
  var apiKey = config.apiKey || '';
  config.hasApiKey = !!apiKey;
  config.apiKeyMasked = apiKey ? maskApiKey_(apiKey) : '';
  config.apiKey = config.apiKeyMasked;
  return config;
}

function maskApiKey_(apiKey) {
  apiKey = String(apiKey || '');
  if (!apiKey) return '';
  if (apiKey.length <= 8) return '********';
  return apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);
}

/** Parses a number, returning the fallback only for missing/invalid input (so 0 is kept). */
function toNumber_(value, fallback, min, max) {
  var n = parseFloat(value);
  if (isNaN(n)) return fallback;
  if (min !== undefined && n < min) n = min;
  if (max !== undefined && n > max) n = max;
  return n;
}

/**
 * Validates and normalises config coming from the sidebar.
 * Returns { config } or { error }.
 */
function validateConfig_(input) {
  var out = {};
  for (var key in CONFIG_DEFAULTS) {
    if (key === 'apiKey') continue;
    if (input[key] === undefined || input[key] === null) continue;
    out[key] = String(input[key]);
  }

  if (out.provider !== undefined && !PROVIDERS[out.provider]) {
    return { error: 'Unknown provider: ' + out.provider };
  }
  if (out.model !== undefined) {
    out.model = out.model.trim();
  }
  if (out.temperature !== undefined) out.temperature = String(toNumber_(out.temperature, CONFIG_DEFAULTS.temperature, 0, 2));
  if (out.topP !== undefined) out.topP = String(toNumber_(out.topP, CONFIG_DEFAULTS.topP, 0, 1));
  if (out.maxTokens !== undefined) {
    out.maxTokens = String(Math.round(toNumber_(out.maxTokens, CONFIG_DEFAULTS.maxTokens, 1, 64000)));
  }
  if (out.botColor !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(out.botColor)) {
    return { error: 'Bot color must be a hex color like #3B82F6.' };
  }
  if (out.customBaseUrl !== undefined) {
    out.customBaseUrl = out.customBaseUrl.trim();
    if (out.customBaseUrl && out.customBaseUrl.indexOf('https://') !== 0) {
      return { error: 'Custom API URL must start with https://' };
    }
  }
  if (out.webAppUrl !== undefined) {
    out.webAppUrl = out.webAppUrl.trim();
    if (out.webAppUrl) {
      try { normalizeWebAppUrl_(out.webAppUrl); } catch (err) { return { error: err.message }; }
    }
  }
  if (out.leadCaptureEnabled !== undefined) {
    out.leadCaptureEnabled = out.leadCaptureEnabled === 'true' ? 'true' : 'false';
  }
  if (out.botName !== undefined) out.botName = out.botName.substring(0, 60);
  return { config: out };
}

function saveConfig(config) {
  config = config || {};
  var props = PropertiesService.getDocumentProperties();

  var result = validateConfig_(config);
  if (result.error) {
    throw new Error(result.error);
  }

  if (config.apiKey !== undefined && config.apiKey !== null) {
    var apiKey = String(config.apiKey).trim();
    if (apiKey && apiKey !== maskApiKey_(props.getProperty('apiKey') || '')) {
      props.setProperty('apiKey', apiKey);
    } else if (!apiKey) {
      props.deleteProperty('apiKey');
    }
  }

  props.setProperties(result.config);
  return { success: true };
}

function resetConfig() {
  PropertiesService.getDocumentProperties().deleteAllProperties();
  return { success: true, config: getConfig() };
}

/** Splits stored suggested questions. New format is newline-separated; old was comma-separated. */
function parseSuggestions_(value) {
  value = String(value || '');
  var parts = value.indexOf('\n') !== -1 ? value.split('\n') : value.split(',');
  return parts.map(function(s) { return s.trim(); }).filter(function(s) { return s; });
}

// --- Chat Handler ---

/**
 * Called by the sidebar (test chat) and the widget endpoint.
 * @param {string} message
 * @param {Array} history  previous { role, content } turns
 * @param {string=} sessionId  used for logging
 */
function handleChat(message, history, sessionId) {
  var config = getConfigInternal_();
  if (!config.apiKey) {
    return { error: 'Please set your API key in the Setup tab.' };
  }

  message = sanitizePromptInjection_(sanitizeHtml(message));
  if (!message) {
    return { error: 'Message is required.' };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { error: 'Message too long (max ' + MAX_MESSAGE_LENGTH + ' characters).' };
  }
  history = sanitizeHistory_(history);

  var systemPrompt = config.systemPrompt || '';
  var kbContext = getKnowledgeContext(message);
  if (kbContext) {
    systemPrompt = systemPrompt + kbContext;
  }

  var startTime = new Date().getTime();
  try {
    var result = callAI(config, message, history, systemPrompt);
    var latency = new Date().getTime() - startTime;
    try {
      logConversation(message, result.response, result.model, latency, sessionId || 'sidebar');
    } catch (logErr) {
      console.error('Logging failed: ' + logErr.message);
    }
    return { response: result.response };
  } catch (e) {
    console.error('Chat error: ' + (e && e.message));
    // Errors raised by callAI carry a userMessage that is safe to show.
    if (e && e.userMessage) {
      return { error: e.userMessage };
    }
    return { error: 'Something went wrong talking to the AI provider. Please try again.' };
  }
}

/**
 * Removes HTML tags. Only strips things that look like real tags, so plain
 * text such as "3<5 and 6>4" survives.
 */
function sanitizeHtml(text) {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?[a-zA-Z][^<>]*>/g, '')
    .replace(/javascript:/gi, '')
    .trim();
}

/**
 * Cleans conversation history so every provider accepts it:
 *  - keeps the most recent MAX_HISTORY_ENTRIES turns (not the oldest)
 *  - first turn is from the user (Anthropic/Gemini requirement)
 *  - consecutive same-role turns are merged so roles alternate
 */
function sanitizeHistory_(history) {
  var clean = [];
  if (!history || !history.length) return clean;
  for (var i = 0; i < history.length; i++) {
    var item = history[i] || {};
    var role = item.role === 'assistant' ? 'assistant' : 'user';
    var content = sanitizeHtml(item.content).substring(0, MAX_HISTORY_ENTRY_LENGTH);
    if (role === 'user') content = sanitizePromptInjection_(content);
    if (content) clean.push({ role: role, content: content });
  }
  clean = clean.slice(-MAX_HISTORY_ENTRIES);
  while (clean.length && clean[0].role !== 'user') clean.shift();
  return mergeSameRoleTurns_(clean);
}

function mergeSameRoleTurns_(messages) {
  var merged = [];
  for (var i = 0; i < messages.length; i++) {
    var last = merged[merged.length - 1];
    if (last && last.role === messages[i].role) {
      last.content += '\n\n' + messages[i].content;
    } else {
      merged.push({ role: messages[i].role, content: messages[i].content });
    }
  }
  return merged;
}

/**
 * Removes explicit attempts to override the system prompt. Kept narrow on
 * purpose: broad patterns ("you are now", "system:", "simulate a") also
 * removed words from normal customer questions.
 */
function sanitizePromptInjection_(text) {
  if (!text) return text;
  var patterns = [
    /\b(ignore|disregard|forget)\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules)\b/gi,
    /\boverride\s+(your|the)\s+system\s+prompt\b/gi,
    /<\|?\s*(system|assistant|im_start|im_end)\s*\|?>/gi,
    /\[\/?(system|INST)\]/gi
  ];
  var cleaned = text;
  for (var i = 0; i < patterns.length; i++) {
    cleaned = cleaned.replace(patterns[i], '');
  }
  return cleaned.trim();
}

/**
 * Prevents formula injection: a cell value beginning with = + - @ would be
 * evaluated by Sheets (e.g. =IMPORTXML(...) exfiltrating data).
 */
function sheetSafe_(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

// --- Logging ---

function ensureLogsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('ChatbotLogs');
  if (!sheet) {
    sheet = ss.insertSheet('ChatbotLogs');
    var headers = ['Timestamp', 'Session ID', 'User Message', 'AI Response', 'Model', 'Latency (ms)'];
    sheet.getRange(1, 1, 1, 6).setValues([headers]);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function logConversation(userMsg, aiResponse, model, latency, sessionId) {
  var sheet = ensureLogsSheet();
  sheet.appendRow([
    new Date().toISOString(),
    sheetSafe_(String(sessionId || 'unknown').substring(0, 80)),
    sheetSafe_(userMsg),
    sheetSafe_(aiResponse),
    sheetSafe_(model),
    latency
  ]);
}

// --- Embed Code ---

function getEmbedCode(webAppUrl) {
  var config = getConfigInternal_();
  var url = normalizeWebAppUrl_(webAppUrl || config.webAppUrl || ScriptApp.getService().getUrl());
  return '<script src="' + escapeHtmlAttribute_(withWidgetParam_(url)) + '"></script>';
}

function normalizeWebAppUrl_(url) {
  url = String(url || '').trim();
  if (!url) {
    throw new Error('Web App URL is missing. Paste the /exec URL from Deploy > Manage deployments.');
  }
  if (!/^https:\/\/script\.google\.com\/(?:a\/[^\/]+\/)?macros\/s\/[^?#\/]+\/(?:exec|dev)(?:[?#].*)?$/.test(url)) {
    throw new Error('Invalid Web App URL. Use the Apps Script URL ending in /exec.');
  }
  return url;
}

function withWidgetParam_(url) {
  if (/[?&]widget=true(?:&|#|$)/.test(url)) {
    return url;
  }
  var hash = '';
  var hashIndex = url.indexOf('#');
  if (hashIndex !== -1) {
    hash = url.substring(hashIndex);
    url = url.substring(0, hashIndex);
  }
  return url + (url.indexOf('?') === -1 ? '?' : '&') + 'widget=true' + hash;
}

function escapeHtmlAttribute_(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// --- Lead Capture ---

function ensureLeadsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Leads');
  if (!sheet) {
    sheet = ss.insertSheet('Leads');
    var headers = ['Timestamp', 'Name', 'Email', 'Phone', 'Source'];
    sheet.getRange(1, 1, 1, 5).setValues([headers]);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 180);
    sheet.setColumnWidth(2, 150);
    sheet.setColumnWidth(3, 220);
    sheet.setColumnWidth(4, 150);
    sheet.setColumnWidth(5, 100);
  }
  return sheet;
}

function saveLead(data) {
  data = data || {};
  var name = sanitizeHtml(data.name || '').substring(0, 200);
  var email = sanitizeHtml(data.email || '').substring(0, 320);
  var phone = sanitizeHtml(data.phone || '').substring(0, 50);
  var source = sanitizeHtml(data.source || 'sidebar').substring(0, 50);

  if (!name) return { error: 'Name is required.' };
  if (!email) return { error: 'Email is required.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Please enter a valid email address.' };
  }

  var sheet = ensureLeadsSheet();
  sheet.appendRow([
    new Date().toISOString(),
    sheetSafe_(name),
    sheetSafe_(email),
    sheetSafe_(phone),
    sheetSafe_(source)
  ]);
  return { success: true };
}

/** Converts a cell value to a string safe to return via google.script.run (Dates are not). */
function cellToString_(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : value.toISOString();
  }
  return String(value);
}

/**
 * Returns summary stats and recent activity for the dashboard.
 */
function getDashboardData() {
  var config = getConfigInternal_();
  var kbEntries = getKnowledgeEntries();

  var leadsSheet = ensureLeadsSheet();
  var leadsData = leadsSheet.getDataRange().getValues();
  var leadCount = Math.max(0, leadsData.length - 1);

  var recentLeads = [];
  for (var j = leadsData.length - 1; j >= 1 && recentLeads.length < 3; j--) {
    recentLeads.push({
      name: cellToString_(leadsData[j][1]),
      email: cellToString_(leadsData[j][2])
    });
  }

  // Only read the last few log rows; the log sheet can grow large.
  var logsSheet = ensureLogsSheet();
  var recentLogs = [];
  var lastRow = logsSheet.getLastRow();
  if (lastRow > 1) {
    var n = Math.min(5, lastRow - 1);
    var logsData = logsSheet.getRange(lastRow - n + 1, 1, n, 5).getValues();
    for (var i = logsData.length - 1; i >= 0; i--) {
      recentLogs.push({
        timestamp: cellToString_(logsData[i][0]),
        userMsg: cellToString_(logsData[i][2]),
        model: cellToString_(logsData[i][4])
      });
    }
  }

  return {
    kbCount: kbEntries.length,
    leadCount: leadCount,
    hasApiKey: !!config.apiKey,
    hasWebAppUrl: !!config.webAppUrl,
    recentLogs: recentLogs,
    recentLeads: recentLeads
  };
}
