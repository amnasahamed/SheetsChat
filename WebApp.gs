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
  var html = '<!DOCTYPE html><html><head><title>Chatbot Builder</title>';
  html += '<style>body{font-family:system-ui;max-width:600px;margin:40px auto;padding:20px;}';
  html += 'h1{color:#3B82F6;}p{color:#666;}.status{color:#10B981;font-weight:bold;}</style></head><body>';
  html += '<h1>Chatbot Builder API</h1>';
  html += '<p class="status">Active</p>';
  html += '<p>Add the embed code to your website to start chatting.</p>';
  html += '</body></html>';
  return HtmlService.createHtmlOutput(html);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var message = body.message;
    var history = body.history || [];

    var config = getConfig();
    var startTime = new Date().getTime();
    var result = callAI(config, message, history);
    var latency = new Date().getTime() - startTime;
    logConversation(message, result.response, result.model, latency);

    return corsResponse({ response: result.response });
  } catch (err) {
    return corsResponse({ error: err.message });
  }
}

// --- Widget JS Server (Task 12) ---

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

  // This is a placeholder — Task 13 will expand buildWidgetJS with the full widget
  // For now, return a minimal self-executing function
  return '(function(){' +
    'var C=' + JSON.stringify(c) + ';' +
    'var d=document.createElement("div");' +
    'd.innerHTML="<div style=\\"position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;background:"+C.botColor+";display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:99999;\\"><svg width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'white\\'><path d=\\'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z\\"/></svg></div>";' +
    'document.body.appendChild(d);' +
    '})();';
}
