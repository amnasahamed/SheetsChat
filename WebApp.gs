// WebApp.gs — Web app endpoints for widget

function corsResponse(content) {
  return ContentService.createTextOutput(JSON.stringify(content))
    .setMimeType(ContentService.MimeType.JSON);
}

var RATE_LIMIT_MAX = 30;
var RATE_LIMIT_WINDOW = 60;
var MAX_MESSAGE_LENGTH = 4000;
var MAX_HISTORY_ENTRIES = 20;
var MAX_HISTORY_ENTRY_LENGTH = 2000;

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  if (params.widget === 'true') {
    return serveWidget();
  }
  if (params.api === 'chat' || params.api === 'lead') {
    return serveJsonpApi_(params);
  }
  // Status page
  var html = '<!DOCTYPE html><html><head><title>SheetsChat</title>';
  html += '<style>body{font-family:system-ui;max-width:680px;margin:40px auto;padding:20px;color:#0F172A;}';
  html += 'h1{color:#3B82F6;}p{color:#475569;line-height:1.6}.status{color:#10B981;font-weight:bold;}';
  html += 'pre{white-space:pre-wrap;word-break:break-all;background:#0F172A;color:#E2E8F0;padding:14px;border-radius:8px;}';
  html += 'button{background:#3B82F6;color:#fff;border:0;border-radius:6px;padding:10px 14px;font-weight:600;cursor:pointer;}</style></head><body>';
  html += '<h1>SheetsChat API</h1>';
  html += '<p class="status">Active</p>';
  html += '<p>Copy this widget code into your website.</p>';
  html += '<pre id="embed"></pre>';
  html += '<button onclick="copyEmbed()">Copy widget code</button>';
  html += '<script>';
  html += 'var base=location.href.split("?")[0].split("#")[0];';
  html += 'var code="<script src=\\"" + base + "?widget=true\\"><\\/script>";';
  html += 'document.getElementById("embed").textContent=code;';
  html += 'function copyEmbed(){navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(code):null;}';
  html += '</script>';
  html += '</body></html>';
  return HtmlService.createHtmlOutput(html);
}

function doPost(e) {
  try {
    if (e && e.parameter && e.parameter.transport === 'iframe') {
      return serveIframeApi_(e.parameter);
    }
    var rawBody = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var body = JSON.parse(rawBody);
    return corsResponse(handleWidgetRequest_(body));
  } catch (err) {
    return corsResponse({ error: err.message || 'Server error.' });
  }
}

function handleWidgetRequest_(body) {
  body = body || {};
  var sessionId = body.sessionId || body.session_id || 'anon';

  if (!checkRateLimit(sessionId)) {
    return { error: 'Rate limited. Please wait a moment and try again.' };
  }

  if (body.type === 'lead') {
    return saveLead(body);
  }

  if (!body.message || typeof body.message !== 'string') {
    return { error: 'Message is required.' };
  }
  if (body.message.length > MAX_MESSAGE_LENGTH) {
    return { error: 'Message too long (max ' + MAX_MESSAGE_LENGTH + ' characters).' };
  }

  var history = sanitizeWidgetHistory_(body.history);
  return handleChat(body.message, history);
}

function sanitizeWidgetHistory_(history) {
  var clean = [];
  if (history && Array.isArray(history)) {
    for (var i = 0; i < Math.min(history.length, MAX_HISTORY_ENTRIES); i++) {
      var h = history[i];
      if (h && typeof h.content === 'string' && h.content.length <= MAX_HISTORY_ENTRY_LENGTH) {
        var role = h.role === 'assistant' ? 'assistant' : 'user';
        clean.push({ role: role, content: sanitizeHtml(h.content) });
      }
    }
  }
  return clean;
}

function serveJsonpApi_(params) {
  var callback = sanitizeJsonpCallback_(params.callback || '');
  if (!callback) {
    return ContentService.createTextOutput('/* Missing callback */')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  var result;
  try {
    var body = params.payload ? JSON.parse(params.payload) : {};
    if (params.api === 'lead') {
      body.type = 'lead';
    }
    result = handleWidgetRequest_(body);
  } catch (err) {
    result = { error: err.message || 'Server error.' };
  }

  return ContentService.createTextOutput(callback + '(' + safeJsonForScript_(result) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function sanitizeJsonpCallback_(callback) {
  callback = String(callback || '');
  return /^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(callback) ? callback : '';
}

function serveIframeApi_(params) {
  var callbackId = sanitizeCallbackId_(params.callbackId || '');
  if (!callbackId) {
    return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8">');
  }

  var result;
  try {
    var body = params.payload ? JSON.parse(params.payload) : {};
    result = handleWidgetRequest_(body);
  } catch (err) {
    result = { error: err.message || 'Server error.' };
  }

  var message = {
    source: 'SheetsChat',
    callbackId: callbackId,
    result: result
  };
  var html = '<!doctype html><html><body><script>' +
    'parent.postMessage(' + safeJsonForScript_(message) + ',"*");' +
    '</script></body></html>';
  return HtmlService.createHtmlOutput(html);
}

function sanitizeCallbackId_(callbackId) {
  callbackId = String(callbackId || '');
  return /^[A-Za-z0-9_-]{1,80}$/.test(callbackId) ? callbackId : '';
}

function safeJsonForScript_(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// --- Widget JS Server (Task 12) ---

function serveWidget() {
  var config = getConfigInternal_();
  var widgetJs = buildWidgetJS(config);
  return ContentService.createTextOutput(widgetJs)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function buildWidgetJS(config) {
  var suggestions = (config.suggestedQuestions || '').split(',').filter(function(s){return s.trim();});
  var c = {
    botName: config.botName || 'Assistant',
    botColor: config.botColor || '#3B82F6',
    endpoint: '',
    welcomeMessage: config.welcomeMessage || '',
    suggestions: suggestions,
    leadCapture: config.leadCaptureEnabled === 'true'
  };
  var json = safeJsonForScript_(c);

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
    '.cb-dark .cb-dot{background:#6B7280;}',
    '.cb-dark #cb-input-area{background:#1F2937;border-top-color:#374151;}',
    '.cb-dark #cb-input{background:#374151;color:#E5E7EB;border-color:#4B5563;}',
    '.cb-dark #cb-input:focus{border-color:' + c.botColor + ';}',
    '.cb-dark #cb-header{background:' + c.botColor + ';}',
    '#cb-suggestions{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 12px;}',
    '.cb-sug{padding:6px 12px;border-radius:16px;border:1px solid #D1D5DB;background:#fff;font-size:12px;cursor:pointer;color:#374151;font-family:system-ui;transition:background 0.2s,border-color 0.2s;}',
    '.cb-sug:hover{background:#EFF6FF;border-color:' + c.botColor + ';color:' + c.botColor + ';}',
    '.cb-dark .cb-sug{background:#374151;color:#E5E7EB;border-color:#4B5563;}',
    '.cb-dark .cb-sug:hover{border-color:' + c.botColor + ';}',
    '#cb-lead-form{padding:24px 16px;display:flex;flex-direction:column;gap:10px;flex:1;justify-content:center;}',
    '#cb-lead-form div{font-size:14px;font-weight:600;color:#374151;text-align:center;}',
    '#cb-lead-form input{width:100%;padding:10px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:14px;font-family:system-ui;outline:none;}',
    '#cb-lead-form input:focus{border-color:' + c.botColor + ';}',
    '#cb-lead-form button{width:100%;padding:10px;border:none;border-radius:8px;background:' + c.botColor + ';color:white;font-size:14px;font-weight:600;cursor:pointer;font-family:system-ui;}',
    '#cb-lead-form button:hover{opacity:0.9;}',
    '.cb-dark #cb-lead-form div{color:#E5E7EB;}',
    '.cb-dark #cb-lead-form input{background:#374151;color:#E5E7EB;border-color:#4B5563;}',
    '@media(prefers-reduced-motion:reduce){.cb-msg,.cb-dot,#cb-panel{animation:none!important;transition:none!important;}}'
  ].join('\n');

  return '(function(){' +
    'var C=' + json + ';' +
    'var D=document;' +
    'var currentScript=D.currentScript||function(){var ss=D.getElementsByTagName("script");return ss[ss.length-1];}();' +
    'var originalSrc=currentScript&&currentScript.src?currentScript.src:"";' +
    'C.endpoint=originalSrc.split("?")[0];' +

    // Inject CSS
    'var s=D.createElement("style");' +
    's.textContent=' + safeJsonForScript_(css) + ';' +
    'D.head.appendChild(s);' +

    // Create root
    'var root=D.createElement("div");root.id="cb-root";' +

    // Detect dark mode (must be after root is created)
    'if(window.matchMedia&&window.matchMedia("(prefers-color-scheme:dark)").matches){root.classList.add("cb-dark");}' +

    // Create bubble
    'var bubble=D.createElement("button");bubble.id="cb-bubble";bubble.setAttribute("aria-label","Open chat");' +
    'bubble.innerHTML=\'<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>\';' +

    // Create panel
    'var panel=D.createElement("div");panel.id="cb-panel";' +

    // Header
    'var hdr=D.createElement("div");hdr.id="cb-header";' +
    'var nm=D.createElement("span");nm.textContent=C.botName;' +
    'var cls=D.createElement("button");cls.id="cb-close";cls.innerHTML="\\u2715";cls.setAttribute("aria-label","Close chat");' +
    'hdr.appendChild(nm);hdr.appendChild(cls);' +

    // Messages
    'var msgs=D.createElement("div");msgs.id="cb-messages";' +

    // Typing indicator
    'var typ=D.createElement("div");typ.id="cb-typing";' +
    'typ.innerHTML=\'<div class="cb-dot"></div><div class="cb-dot"></div><div class="cb-dot"></div>\';' +

    // Input area
    'var inpArea=D.createElement("div");inpArea.id="cb-input-area";' +
    'var inp=D.createElement("input");inp.id="cb-input";inp.type="text";inp.placeholder="Type a message...";' +
    'var sendBtn=D.createElement("button");sendBtn.id="cb-send";sendBtn.setAttribute("aria-label","Send message");' +
    'sendBtn.innerHTML=\'<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>\';' +
    'inpArea.appendChild(inp);inpArea.appendChild(sendBtn);' +

    // Assemble panel
    'panel.appendChild(hdr);panel.appendChild(msgs);' +
    'var sugDiv=D.createElement("div");sugDiv.id="cb-suggestions";panel.appendChild(sugDiv);' +
    // Lead capture form
    'var lf=D.createElement("div");lf.id="cb-lead-form";lf.style.display="none";' +
    'lf.innerHTML=\'<div>Before we chat, tell us about yourself</div><input id="cb-lead-name" placeholder="Your name"><input id="cb-lead-email" placeholder="Your email" type="email"><button onclick="">Start Chat</button>\';' +
    'panel.appendChild(lf);' +
    'panel.appendChild(typ);panel.appendChild(inpArea);' +

    // Assemble root
    'root.appendChild(bubble);root.appendChild(panel);' +
    'D.body.appendChild(root);' +

    // State
    'var isOpen=false;var H=[];var sending=false;var leadDone=false;var lastFailed="";var SID="anon";' +
    'try{SID=sessionStorage.getItem("cb_sid")||("s_"+Math.random().toString(36).slice(2)+"_"+Date.now().toString(36));sessionStorage.setItem("cb_sid",SID);}catch(e){SID="s_"+Math.random().toString(36).slice(2);}' +
    'try{H=JSON.parse(sessionStorage.getItem("cb_h")||"[]");}catch(e){}' +
    'try{leadDone=!!sessionStorage.getItem("cb_lead");}catch(e){}' +

    // Restore history
    'function restoreHistory(){' +
    'msgs.innerHTML="";' +
    'var sugEl=D.getElementById("cb-suggestions");' +
    'if(H.length===0){' +
    'if(C.welcomeMessage){appendMsg("bot",C.welcomeMessage);}' +
    'if(C.suggestions&&C.suggestions.length>0&&sugEl){' +
    'sugEl.innerHTML="";' +
    'for(var s=0;s<C.suggestions.length;s++){' +
    'var sb=D.createElement("button");sb.className="cb-sug";sb.textContent=C.suggestions[s];' +
    'sb.addEventListener("click",(function(t){return function(){inp.value=t;send();if(sugEl)sugEl.style.display="none";};})(C.suggestions[s]));' +
    'sugEl.appendChild(sb);}sugEl.style.display="flex";}' +
    '}else{' +
    'if(sugEl)sugEl.style.display="none";' +
    'for(var i=0;i<H.length;i++){' +
    'var m=H[i];' +
    'var b=D.createElement("div");' +
    'b.className=m.role==="user"?"cb-msg cb-user":"cb-msg cb-bot";' +
    'b.textContent=m.content;' +
    'msgs.appendChild(b);' +
    '}}' +
    'scrollDown();' +
    '}' +

    // Append message bubble
    'function appendMsg(role,text){' +
    'var b=D.createElement("div");' +
    'if(role==="error"){b.className="cb-err";' +
    'b.textContent=text;' +
    'var rb=D.createElement("button");rb.textContent="Retry";rb.style.cssText="margin-top:6px;padding:4px 12px;border:1px solid #D1D5DB;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;font-family:system-ui;";' +
    'rb.addEventListener("click",function(){b.remove();if(lastFailed){inp.value=lastFailed;send();}});' +
    'b.appendChild(rb);}' +
    'else{b.className=role==="user"?"cb-msg cb-user":"cb-msg cb-bot";b.textContent=text;}' +
    'msgs.appendChild(b);scrollDown();' +
    '}' +

    'function scrollDown(){msgs.scrollTop=msgs.scrollHeight;}' +
    'function showTyping(){typ.style.display="flex";scrollDown();}' +
    'function hideTyping(){typ.style.display="none";}' +
    'function request(payload,ok,fail){' +
    'var cb="cb_iframe_"+Date.now()+"_"+Math.random().toString(36).slice(2);' +
    'var done=false;' +
    'var timer=setTimeout(function(){if(!done){cleanup();fail(new Error("Request timed out"));}},30000);' +
    'function onMessage(ev){var data=ev.data||{};if(data.source==="SheetsChat"&&data.callbackId===cb){done=true;cleanup();ok(data.result||{});}}' +
    'function cleanup(){clearTimeout(timer);window.removeEventListener("message",onMessage);if(form&&form.parentNode){form.parentNode.removeChild(form);}if(frame&&frame.parentNode){frame.parentNode.removeChild(frame);}}' +
    'window.addEventListener("message",onMessage);' +
    'var frame=D.createElement("iframe");frame.name=cb;frame.style.display="none";' +
    'var form=D.createElement("form");form.method="POST";form.action=C.endpoint;form.target=cb;form.style.display="none";' +
    'function add(name,value){var input=D.createElement("input");input.type="hidden";input.name=name;input.value=value;form.appendChild(input);}' +
    'add("transport","iframe");add("callbackId",cb);add("payload",JSON.stringify(payload));' +
    'D.body.appendChild(frame);D.body.appendChild(form);' +
    'try{form.submit();}catch(e){cleanup();fail(e);}' +
    '}' +

    // Toggle panel
    'function toggle(){' +
    'isOpen=!isOpen;' +
    'if(isOpen){' +
    'bubble.style.display="none";' +
    'panel.style.display="flex";' +
    'if(C.leadCapture&&!leadDone){showLeadForm();}' +
    'else{restoreHistory();}' +
    'inp.focus();' +
    '}else{' +
    'panel.style.display="none";' +
    'bubble.style.display="flex";' +
    '}' +
    '}' +

    // Lead form logic
    'function showLeadForm(){' +
    'lf.style.display="flex";msgs.style.display="none";sugDiv.style.display="none";typ.style.display="none";inpArea.style.display="none";' +
    'var lfBtn=lf.querySelector("button");' +
    'lfBtn.onclick=function(){' +
    'var n=D.getElementById("cb-lead-name").value.trim();' +
    'var em=D.getElementById("cb-lead-email").value.trim();' +
    'if(!n||!em){alert("Please enter name and email.");return;}' +
    'request({type:"lead",name:n,email:em,source:"widget",sessionId:SID},function(d){' +
    'if(d.error){alert(d.error);return;}' +
    'leadDone=true;try{sessionStorage.setItem("cb_lead","1");}catch(e){}' +
    'lf.style.display="none";msgs.style.display="flex";inpArea.style.display="flex";' +
    'restoreHistory();' +
    '},function(){alert("Connection error. Please try again.");});' +
    '};' +
    '}' +

    // Send message
    'function send(){' +
    'var txt=inp.value.trim();' +
    'if(!txt||sending)return;' +
    'sending=true;sendBtn.disabled=true;sendBtn.style.opacity="0.5";' +
    'inp.value="";' +
    'appendMsg("user",txt);' +
    'H.push({role:"user",content:txt});' +
    'showTyping();' +
    'var priorH=[];' +
    'var start=Math.max(0,H.length-7);' +
    'for(var i=start;i<H.length-1;i++){priorH.push({role:H[i].role,content:String(H[i].content||"").slice(0,800)});}' +

    'request({message:txt,history:priorH,sessionId:SID},function(d){' +
    'hideTyping();' +
    'if(d.error){H.pop();lastFailed=txt;appendMsg("error","Error: "+d.error);}' +
    'else{lastFailed="";appendMsg("bot",d.response);H.push({role:"assistant",content:d.response});}' +
    'sessionStorage.setItem("cb_h",JSON.stringify(H));' +
    'sending=false;sendBtn.disabled=false;sendBtn.style.opacity="";' +
    '},function(e){' +
    'hideTyping();' +
    'H.pop();' +
    'lastFailed=txt;' +
    'appendMsg("error","Connection error. Please try again.");' +
    'sessionStorage.setItem("cb_h",JSON.stringify(H));' +
    'sending=false;sendBtn.disabled=false;sendBtn.style.opacity="";' +
    '});' +
    '}' +

    // Event listeners
    'bubble.addEventListener("click",toggle);' +
    'cls.addEventListener("click",toggle);' +
    'sendBtn.addEventListener("click",send);' +
    'inp.addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}});' +

    '})();';
}

/**
 * Rate limiting using CacheService.
 * Returns true if request is allowed, false if rate limited.
 * Limit: 30 requests per sessionId per 60 seconds.
 */
function checkRateLimit(sessionId) {
  if (!sessionId) sessionId = 'anonymous';
  sessionId = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '').substring(0, 80) || 'anonymous';
  var cacheKey = 'rl_' + sessionId;
  var cache = CacheService.getScriptCache();
  var countStr = cache.get(cacheKey);
  var count = countStr ? parseInt(countStr, 10) : 0;
  if (count >= RATE_LIMIT_MAX) {
    return false;
  }
  cache.put(cacheKey, String(count + 1), RATE_LIMIT_WINDOW);
  return true;
}
