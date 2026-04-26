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
  if (e.parameter && e.parameter.widget === 'true') {
    return serveWidget();
  }
  // Status page
  var html = '<!DOCTYPE html><html><head><title>SheetsChat</title>';
  html += '<style>body{font-family:system-ui;max-width:600px;margin:40px auto;padding:20px;}';
  html += 'h1{color:#3B82F6;}p{color:#666;}.status{color:#10B981;font-weight:bold;}</style></head><body>';
  html += '<h1>SheetsChat API</h1>';
  html += '<p class="status">Active</p>';
  html += '<p>Add the embed code to your website to start chatting.</p>';
  html += '</body></html>';
  return HtmlService.createHtmlOutput(html);
}

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

// --- Widget JS Server (Task 12) ---

function serveWidget() {
  var config = getConfig();
  var widgetJs = buildWidgetJS(config);
  return ContentService.createTextOutput(widgetJs)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function buildWidgetJS(config) {
  var suggestions = (config.suggestedQuestions || '').split(',').filter(function(s){return s.trim();});
  var c = {
    botName: config.botName || 'Assistant',
    botColor: config.botColor || '#3B82F6',
    endpoint: ScriptApp.getService().getUrl(),
    welcomeMessage: config.welcomeMessage || '',
    suggestions: suggestions,
    leadCapture: config.leadCaptureEnabled === 'true'
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

    // Inject CSS
    'var s=D.createElement("style");' +
    's.textContent=' + JSON.stringify(css) + ';' +
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
    'var isOpen=false;var H=[];var sending=false;var leadDone=false;' +
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
    'rb.addEventListener("click",function(){b.remove();if(H.length>0){inp.value=H[H.length-1].content;H.pop();send();}});' +
    'b.appendChild(rb);}' +
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
    'fetch(C.endpoint,{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify({type:"lead",name:n,email:em,source:"widget"})});' +
    'leadDone=true;try{sessionStorage.setItem("cb_lead","1");}catch(e){}' +
    'lf.style.display="none";msgs.style.display="flex";inpArea.style.display="flex";' +
    'restoreHistory();' +
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
    'for(var i=0;i<H.length-1;i++){priorH.push({role:H[i].role,content:H[i].content});}' +

    'fetch(C.endpoint,{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify({message:txt,history:priorH})})' +
    '.then(function(r){return r.json();})' +
    '.then(function(d){' +
    'hideTyping();' +
    'if(d.error){appendMsg("error","Error: "+d.error);H.pop();}' +
    'else{appendMsg("bot",d.response);H.push({role:"assistant",content:d.response});}' +
    'sessionStorage.setItem("cb_h",JSON.stringify(H));' +
    'sending=false;sendBtn.disabled=false;sendBtn.style.opacity="";' +
    '})' +
    '.catch(function(e){' +
    'hideTyping();' +
    'appendMsg("error","Connection error. Please try again.");' +
    'H.pop();' +
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
