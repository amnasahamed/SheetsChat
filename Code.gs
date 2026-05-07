function onOpen() {
  ensureConfigSheet();
  ensureKnowledgeSheet();
  ensureLeadsSheet();

  // Migrate API key from DocumentProperties to ScriptProperties (one-time)
  var docProps = PropertiesService.getDocumentProperties();
  var scriptProps = PropertiesService.getScriptProperties();
  var oldKey = docProps.getProperty('apiKey');
  if (oldKey && !scriptProps.getProperty('apiKey')) {
    scriptProps.setProperty('apiKey', oldKey);
    docProps.deleteProperty('apiKey');
  }

  SpreadsheetApp.getUi()
    .createMenu('SheetsChat')
    .addItem('Open', 'openSidebar')
    .addToUi();
}

function openSidebar() {
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

function getConfigInternal_() {
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

function saveConfig(config) {
  var props = PropertiesService.getDocumentProperties();
  var scriptProps = PropertiesService.getScriptProperties();

  // Store API key in ScriptProperties (not accessible by sheet users)
  if (config.apiKey !== undefined && config.apiKey !== null) {
    var apiKey = String(config.apiKey).trim();
    if (apiKey && apiKey.indexOf('...') === -1) {
      scriptProps.setProperty('apiKey', apiKey);
    } else if (!apiKey) {
      scriptProps.deleteProperty('apiKey');
    }
  }

  // Store everything else in DocumentProperties
  for (var key in config) {
    if (key === 'apiKey') continue;
    if (config[key] !== undefined && config[key] !== null) {
      props.setProperty(key, String(config[key]));
    }
  }
  return { success: true };
}

function resetConfig() {
  var props = PropertiesService.getDocumentProperties();
  var scriptProps = PropertiesService.getScriptProperties();
  props.deleteAllProperties();
  scriptProps.deleteProperty('apiKey');
  return { success: true, config: getConfig() };
}

function ensureConfigSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('ChatbotConfig');
  if (!sheet) {
    sheet = ss.insertSheet('ChatbotConfig');
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

// --- Chat Handler ---

function handleChat(message, history) {
  var config = getConfigInternal_();
  if (!config.apiKey) {
    return { error: 'Please set your API key in the Setup tab.' };
  }

  // Sanitize user message
  message = sanitizeHtml(message);
  message = sanitizePromptInjection_(message);
  history = sanitizeHistory_(history);

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
    var errMsg = e.message || '';
    if (errMsg.indexOf('401') !== -1) {
      return { error: 'Invalid API key. Check your key in the Setup tab.' };
    }
    if (errMsg.indexOf('429') !== -1) {
      return { error: 'Rate limited by AI provider. Wait a moment and try again.' };
    }
    // Wrap parse errors with generic message (don't leak provider details)
    if (errMsg.indexOf('Unexpected') !== -1 && errMsg.indexOf('response format') !== -1) {
      console.error('Parse error (details logged): ' + errMsg);
      return { error: 'The AI service returned an unexpected response. Please try again.' };
    }
    return { error: 'AI Error: ' + errMsg };
  }
}

/**
 * Strips HTML tags from a string to prevent injection.
 */
function sanitizeHtml(text) {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .trim();
}

function sanitizeHistory_(history) {
  var clean = [];
  if (!history || !history.length) return clean;
  for (var i = 0; i < history.length && clean.length < 20; i++) {
    var item = history[i] || {};
    var role = item.role === 'assistant' ? 'assistant' : 'user';
    var content = sanitizeHtml(item.content);
    if (content) {
      clean.push({ role: role, content: content.substring(0, 2000) });
    }
  }
  return clean;
}

/**
 * Filters common prompt injection patterns from user messages.
 * Strips attempts to override system instructions.
 */
function sanitizePromptInjection_(text) {
  if (!text) return text;
  var cleaned = text;
  // Strip common system-prompt override patterns (case-insensitive)
  var patterns = [
    /ignore\s+(all\s+)?previous\s+instructions?/gi,
    /ignore\s+(all\s+)?prior\s+instructions?/gi,
    /you\s+are\s+now\s+/gi,
    /system\s*:/gi,
    /(\[|\()<\|?(system|assistant)(\]|\))/gi,
    /<\|?(system|assistant)\|?>/gi,
    /forget\s+(all\s+)?(your|previous|prior)\s+/gi,
    /new\s+instructions?\s*:/gi,
    /disregard\s+(all\s+)?(previous|prior|above)\s+/gi,
    /override\s+(your|the)\s+(system|previous|prior)\s+/gi,
    /pretend\s+you\s+are\s+/gi,
    /act\s+as\s+if\s+you\s+(are|were)\s+/gi,
    /from\s+now\s+on\s*[,]\s*you\s+are\s+/gi,
    /simulate\s+(being|a|an)\s+/gi,
    /jailbreak/gi,
    /DAN\s+mode/gi,
    /developer\s+mode/gi,
    /\/(?:system|assistant|override)/gi
  ];
  for (var i = 0; i < patterns.length; i++) {
    cleaned = cleaned.replace(patterns[i], '');
  }
  return cleaned;
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
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^?#]+\/(?:exec|dev)(?:[?#].*)?$/.test(url)) {
    throw new Error('Invalid Web App URL. Use the Apps Script URL ending in /exec.');
  }
  return url;
}

function withWidgetParam_(url) {
  if (/[?&]widget=true(?:&|$)/.test(url)) {
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
  var sheet = ensureLeadsSheet();
  data = data || {};
  sheet.appendRow([
    new Date().toISOString(),
    sanitizeHtml(data.name || '').substring(0, 200),
    sanitizeHtml(data.email || '').substring(0, 320),
    sanitizeHtml(data.phone || '').substring(0, 50),
    sanitizeHtml(data.source || 'sidebar').substring(0, 50)
  ]);
  return { success: true };
}

/**
 * Returns summary stats and recent activity for the dashboard.
 */
function getDashboardData() {
  var config = getConfigInternal_();
  var kbEntries = getKnowledgeEntries();

  var leadsSheet = ensureLeadsSheet();
  var leadsData = leadsSheet.getDataRange().getValues();
  var leadCount = leadsData.length - 1;
  if (leadCount < 0) leadCount = 0;

  var recentLeads = [];
  // Get last 3 leads
  for (var j = leadsData.length - 1; j >= 1 && recentLeads.length < 3; j--) {
    recentLeads.push({
      name: leadsData[j][1],
      email: leadsData[j][2]
    });
  }

  var logsSheet = ensureLogsSheet();
  var logsData = logsSheet.getDataRange().getValues();
  var recentLogs = [];
  // Get last 5 logs (skipping header)
  for (var i = logsData.length - 1; i >= 1 && recentLogs.length < 5; i--) {
    recentLogs.push({
      timestamp: logsData[i][0],
      userMsg: logsData[i][2],
      model: logsData[i][4]
    });
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
