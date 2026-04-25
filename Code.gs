function onOpen() {
  ensureConfigSheet();
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
