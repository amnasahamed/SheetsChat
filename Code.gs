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

var CONFIG_DEFAULTS = {
  provider: 'openai',
  model: 'gpt-5.5',
  apiKey: '',
  customBaseUrl: '',
  systemPrompt: 'You are a helpful assistant.',
  botName: 'Assistant',
  botColor: '#3B82F6',
  temperature: 0.7,
  maxTokens: 1024,
  topP: 1.0,
  welcomeMessage: 'Hello! How can I help you today?',
  suggestedQuestions: '',
  leadCaptureEnabled: 'false'
};

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

function saveConfig(config) {
  var props = PropertiesService.getDocumentProperties();
  var scriptProps = PropertiesService.getScriptProperties();

  // Store API key in ScriptProperties (not accessible by sheet users)
  if (config.apiKey !== undefined && config.apiKey !== null) {
    scriptProps.setProperty('apiKey', String(config.apiKey));
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
  return { success: true, config: CONFIG_DEFAULTS };
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

/**
 * Strips HTML tags from a string to prevent injection.
 */
function sanitizeHtml(text) {
  return text.replace(/<[^>]*>/g, '');
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

function getEmbedCode() {
  var url = ScriptApp.getService().getUrl();
  return '<script src="' + url + '?widget=true"></script>';
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
  sheet.appendRow([
    new Date().toISOString(),
    data.name || '',
    data.email || '',
    data.phone || '',
    data.source || 'sidebar'
  ]);
  return { success: true };
}
