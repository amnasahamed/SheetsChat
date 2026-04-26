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
  var json = JSON.stringify(c);

  var css = [
    '#cb-root *{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;}',
    '#cb-bubble{position:fixed;bottom:24px;right:24px;width:60px;height:60px;border-radius:50%;background:' + c.botColor + ';display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.25);z-index:999999;transition:transform 0.2s,opacity 0.2s;border:none;}',
    '#cb-bubble:hover{transform:scale(1.08);}',
    '#cb-bubble svg{width:28px;height:28px;fill:white;}',
    '#cb-panel{position:fixed;bottom:24px;right:24px;width:380px;height:520px;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.2);z-index:999999;display:none;flex-direction:column;overflow:hidden;background:#fff;animation:cbSlideUp 0.3s ease;}',
    '@keyframes cbSlideUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}',
    '#cb-header{height:52px;background:' + c.botColor + ';color:white;display:flex;align-items:center;justify-content:space-between;padding:0 16px;flex-shrink:0;}',
    '#cb-header span{font-size:16px;font-weight:600;}',
    '#cb-close{background:none;border:none;color:white;font-size:22px;cursor:pointer;line-height:1;padding:4px 8px;border-radius:4px;}',
    '#cb-close:hover{background:rgba(255,255,255,0.2);}',
    '#cb-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;background:#fff;}',
    '.cb-msg{max-width:80%;padding:10px 14px;border-radius:16px;font-size:14px;line-height:1.5;word-wrap:break-word;animation:cbFadeIn 0.2s ease;}',
    '@keyframes cbFadeIn{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:translateY(0);}}',
    '.cb-user{align-self:flex-end;background:' + c.botColor + ';color:white;border-radius:16px 16px 4px 16px;}',
    '.cb-bot{align-self:flex-start;background:#F3F4F6;color:#1F2937;border-radius:16px 16px 16px 4px;}',
    '.cb-err{align-self:center;color:#EF4444;font-size:13px;text-align:center;}',
    '#cb-typing{align-self:flex-start;padding:10px 16px;background:#F3F4F6;border-radius:16px 16px 16px 4px;display:none;gap:4px;align-items:center;}',
    '.cb-dot{width:8px;height:8px;border-radius:50%;background:#9CA3AF;animation:cbBounce 1.4s infinite both;}',
    '.cb-dot:nth-child(2){animation-delay:0.2s;}',
    '.cb-dot:nth-child(3){animation-delay:0.4s;}',
    '@keyframes cbBounce{0%,80%,100%{transform:scale(0.6);opacity:0.4;}40%{transform:scale(1);opacity:1;}}',
    '#cb-input-area{display:flex;padding:12px;gap:8px;border-top:1px solid #E5E7EB;flex-shrink:0;background:#fff;}',
    '#cb-input{flex:1;border:1px solid #D1D5DB;border-radius:24px;padding:10px 16px;font-size:14px;outline:none;transition:border-color 0.2s;}',
    '#cb-input:focus{border-color:' + c.botColor + ';}',
    '#cb-send{width:44px;height:44px;border-radius:50%;background:' + c.botColor + ';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity 0.2s;}',
    '#cb-send:hover{opacity:0.85;}',
    '#cb-send svg{width:20px;height:20px;fill:white;}',
    '@media(max-width:480px){#cb-panel{width:100vw!important;height:100vh!important;bottom:0!important;right:0!important;border-radius:0!important;}}',
    '.cb-dark #cb-panel{background:#1F2937;}',
    '.cb-dark #cb-messages{background:#1F2937;}',
    '.cb-dark .cb-bot{background:#374151;color:#E5E7EB;}',
    '.cb-dark #cb-typing{background:#374151;}',
    '.cb-dark #cb-input-area{background:#1F2937;border-top-color:#374151;}',
    '.cb-dark #cb-input{background:#374151;color:#E5E7EB;border-color:#4B5563;}',
    '.cb-dark #cb-input:focus{border-color:' + c.botColor + ';}'
  ].join('\n');

  return '(function(){' +
    'var C=' + json + ';' +
    'var D=document;' +

    // Inject CSS
    'var s=D.createElement("style");' +
    's.textContent=' + JSON.stringify(css) + ';' +
    'D.head.appendChild(s);' +

    // Detect dark mode
    'var dark=D.createElement("div");' +
    'dark.className="cb-dark";' +
    'if(window.matchMedia&&window.matchMedia("(prefers-color-scheme:dark)").matches){D.documentElement.classList.add("cb-dark");}' +

    // Create root
    'var root=D.createElement("div");root.id="cb-root";' +

    // Create bubble
    'var bubble=D.createElement("button");bubble.id="cb-bubble";' +
    'bubble.innerHTML=\'<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>\';' +

    // Create panel
    'var panel=D.createElement("div");panel.id="cb-panel";' +

    // Header
    'var hdr=D.createElement("div");hdr.id="cb-header";' +
    'var nm=D.createElement("span");nm.textContent=C.botName;' +
    'var cls=D.createElement("button");cls.id="cb-close";cls.innerHTML="\\u2715";' +
    'hdr.appendChild(nm);hdr.appendChild(cls);' +

    // Messages
    'var msgs=D.createElement("div");msgs.id="cb-messages";' +

    // Typing indicator
    'var typ=D.createElement("div");typ.id="cb-typing";' +
    'typ.innerHTML=\'<div class="cb-dot"></div><div class="cb-dot"></div><div class="cb-dot"></div>\';' +

    // Input area
    'var inpArea=D.createElement("div");inpArea.id="cb-input-area";' +
    'var inp=D.createElement("input");inp.id="cb-input";inp.type="text";inp.placeholder="Type a message...";' +
    'var sendBtn=D.createElement("button");sendBtn.id="cb-send";' +
    'sendBtn.innerHTML=\'<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>\';' +
    'inpArea.appendChild(inp);inpArea.appendChild(sendBtn);' +

    // Assemble panel
    'panel.appendChild(hdr);panel.appendChild(msgs);panel.appendChild(typ);panel.appendChild(inpArea);' +

    // Assemble root
    'root.appendChild(bubble);root.appendChild(panel);' +
    'D.body.appendChild(root);' +

    // State
    'var isOpen=false;var H=[];' +
    'try{H=JSON.parse(sessionStorage.getItem("cb_h")||"[]");}catch(e){}' +

    // Restore history
    'function restoreHistory(){' +
    'msgs.innerHTML="";' +
    'for(var i=0;i<H.length;i++){' +
    'var m=H[i];' +
    'var b=D.createElement("div");' +
    'b.className=m.role==="user"?"cb-msg cb-user":"cb-msg cb-bot";' +
    'b.textContent=m.content;' +
    'msgs.appendChild(b);' +
    '}' +
    'scrollDown();' +
    '}' +

    // Append message bubble
    'function appendMsg(role,text){' +
    'var b=D.createElement("div");' +
    'if(role==="error"){b.className="cb-err";b.textContent=text;}' +
    'else{b.className=role==="user"?"cb-msg cb-user":"cb-msg cb-bot";b.textContent=text;}' +
    'msgs.appendChild(b);scrollDown();' +
    '}' +

    'function scrollDown(){msgs.scrollTop=msgs.scrollHeight;}' +
    'function showTyping(){typ.style.display="flex";scrollDown();}' +
    'function hideTyping(){typ.style.display="none";}' +

    // Toggle panel
    'function toggle(){' +
    'isOpen=!isOpen;' +
    'if(isOpen){' +
    'bubble.style.display="none";' +
    'panel.style.display="flex";' +
    'restoreHistory();' +
    'inp.focus();' +
    '}else{' +
    'panel.style.display="none";' +
    'bubble.style.display="flex";' +
    '}' +
    '}' +

    // Send message
    'function send(){' +
    'var txt=inp.value.trim();' +
    'if(!txt)return;' +
    'inp.value="";' +
    'appendMsg("user",txt);' +
    'H.push({role:"user",content:txt});' +
    'showTyping();' +
    'var priorH=[];' +
    'for(var i=0;i<H.length-1;i++){priorH.push({role:H[i].role,content:H[i].content});}' +

    'fetch(C.endpoint,{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify({message:txt,history:priorH})})' +
    '.then(function(r){return r.json();})' +
    '.then(function(d){' +
    'hideTyping();' +
    'if(d.error){appendMsg("error","Error: "+d.error);}' +
    'else{appendMsg("bot",d.response);H.push({role:"assistant",content:d.response});}' +
    'sessionStorage.setItem("cb_h",JSON.stringify(H));' +
    '})' +
    '.catch(function(e){' +
    'hideTyping();' +
    'appendMsg("error","Connection error. Please try again.");' +
    '});' +
    '}' +

    // Event listeners
    'bubble.addEventListener("click",toggle);' +
    'cls.addEventListener("click",toggle);' +
    'sendBtn.addEventListener("click",send);' +
    'inp.addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}});' +

    '})();';
}
