// WebApp.gs — Web app endpoints for widget

function corsResponse(content) {
  return ContentService.createTextOutput(JSON.stringify(content))
    .setMimeType(ContentService.MimeType.JSON);
}

var RATE_LIMIT_MAX = 30;      // per visitor session
var RATE_LIMIT_WINDOW = 60;
var ORIGIN_RATE_LIMIT_MAX = 300; // per website, across all visitors
var ORIGIN_RATE_LIMIT_WINDOW = 60;
var MAX_WIDGET_HISTORY = 10;

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  if (params.widget === 'true') {
    return serveWidget();
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
    console.error('doPost error: ' + (err.message || err));
    return corsResponse({ error: 'An unexpected error occurred. Please try again.' });
  }
}

function handleWidgetRequest_(body) {
  body = body || {};
  var sessionId = String(body.sessionId || body.session_id || 'anon').substring(0, 80);

  // Session-based rate limit
  if (!checkRateLimit(sessionId)) {
    console.error('Rate limit hit for session: ' + sessionId);
    return { error: 'Rate limited. Please wait a moment and try again.' };
  }

  // Secondary rate limit by origin fingerprint to prevent session rotation abuse
  var fpKey = buildFingerprintKey_(body);
  if (fpKey && !checkRateLimit(fpKey, ORIGIN_RATE_LIMIT_MAX, ORIGIN_RATE_LIMIT_WINDOW)) {
    console.error('Rate limit hit for fingerprint: ' + fpKey);
    return { error: 'Rate limited. Please wait a moment and try again.' };
  }

  // Origin validation (client-supplied, best-effort on Apps Script)
  var origin = body.origin || '';
  if (!isOriginAllowed_(origin)) {
    console.error('Origin rejected: ' + origin);
    return { error: 'Origin not allowed. Contact the site owner.' };
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

  // Widget visitors get a shorter window than the sidebar (most recent turns only).
  var history = Array.isArray(body.history) ? body.history.slice(-MAX_WIDGET_HISTORY) : [];
  return handleChat(body.message, history, 'w_' + sessionId);
}

/**
 * Legacy transport kept for widget scripts cached by browsers before the
 * switch to fetch(). New widgets POST JSON to doPost directly.
 */
function serveIframeApi_(params) {
  var callbackId = sanitizeCallbackId_(params.callbackId || '');
  if (!callbackId) {
    return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8">');
  }

  var body = {};
  try {
    body = params.payload ? JSON.parse(params.payload) : {};
  } catch (err) {
    // body stays empty
  }

  var result;
  try {
    result = handleWidgetRequest_(body);
  } catch (err) {
    console.error('Iframe API error: ' + (err.message || err));
    result = { error: 'An unexpected error occurred. Please try again.' };
  }

  var message = {
    source: 'SheetsChat',
    callbackId: callbackId,
    result: result
  };
  // Reply only to the requesting page's origin (never "*"). handleWidgetRequest_
  // has already checked it against allowedDomains, so any allowed domain or
  // subdomain works, not just the first one configured.
  var targetOrigin = normalizeOrigin_(body.origin) || 'https://script.google.com';
  var html = '<!doctype html><html><body><script>' +
    'parent.postMessage(' + safeJsonForScript_(message) + ',' + JSON.stringify(targetOrigin) + ');' +
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
  var suggestions = parseSuggestions_(config.suggestedQuestions);
  var c = {
    botName: config.botName || 'Assistant',
    // Interpolated into CSS below, so only a strict hex color is allowed.
    botColor: /^#[0-9A-Fa-f]{6}$/.test(config.botColor || '') ? config.botColor : '#3B82F6',
    endpoint: '',
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
    'var currentScript=D.currentScript||function(){var ss=D.getElementsByTagName("script");return ss[ss.length-1];}();' +
    'var originalSrc=currentScript&&currentScript.src?currentScript.src:"";' +
    'C.endpoint=originalSrc.split("?")[0];' +

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
    'var lfTitle=D.createElement("div");lfTitle.textContent="Before we chat, tell us about yourself";lf.appendChild(lfTitle);' +
    'var lfName=D.createElement("input");lfName.id="cb-lead-name";lfName.placeholder="Your name";lf.appendChild(lfName);' +
    'var lfEmail=D.createElement("input");lfEmail.id="cb-lead-email";lfEmail.placeholder="Your email";lfEmail.type="email";lf.appendChild(lfEmail);' +
    'var lfBtn=D.createElement("button");lfBtn.textContent="Start Chat";lf.appendChild(lfBtn);' +
    'panel.appendChild(lf);' +
    'panel.appendChild(typ);panel.appendChild(inpArea);' +

    // Assemble root
    'root.appendChild(bubble);root.appendChild(panel);' +
    'D.body.appendChild(root);' +

    // State
    'var isOpen=false;var H=[];var sending=false;var leadDone=false;var lastFailed="";var SID="anon";var WO=window.location?window.location.origin:"";' +
    'function sGet(k){try{return sessionStorage.getItem(k);}catch(e){return null;}}' +
    'function sSet(k,v){try{sessionStorage.setItem(k,v);}catch(e){}}' +
    'SID=sGet("cb_sid")||("s_"+Math.random().toString(36).slice(2)+"_"+Date.now().toString(36));sSet("cb_sid",SID);' +
    'try{H=JSON.parse(sGet("cb_h")||"[]");if(!Array.isArray(H))H=[];}catch(e){H=[];}' +
    'leadDone=!!sGet("cb_lead");' +
    'function saveH(){if(H.length>40)H=H.slice(-40);sSet("cb_h",JSON.stringify(H));}' +

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
    'b.innerHTML=m.role==="user"?esc(String(m.content||"")):linkify(String(m.content||""));' +
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
    'else{b.className=role==="user"?"cb-msg cb-user":"cb-msg cb-bot";b.innerHTML=linkify(text);}' +
    'msgs.appendChild(b);scrollDown();' +
    '}' +

    // Linkify URLs and emails in bot messages
    // (single pass, so an email inside a URL is not wrapped twice)
    'function esc(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}' +
    'function linkify(t){' +
    'var re=/(https?:\\/\\/[^\\s<>"]+[^\\s<>".,;:!?)\\]])|([\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+)/g;' +
    'var out="",last=0,m;' +
    'while((m=re.exec(t))){out+=esc(t.slice(last,m.index));' +
    'if(m[1]){out+="<a href=\\""+esc(m[1])+"\\" target=\\"_blank\\" rel=\\"noopener noreferrer\\">"+esc(m[1])+"</a>";}' +
    'else{out+="<a href=\\"mailto:"+esc(m[2])+"\\">"+esc(m[2])+"</a>";}' +
    'last=re.lastIndex;}' +
    'return out+esc(t.slice(last));' +
    '}' +

    'function scrollDown(){msgs.scrollTop=msgs.scrollHeight;}' +
    'function showTyping(){typ.style.display="flex";scrollDown();}' +
    'function hideTyping(){typ.style.display="none";}' +
    // POST JSON as text/plain (a "simple" request: no CORS preflight). Apps Script
    // answers with a redirect to a googleusercontent URL that allows any origin.
    'function request(payload,ok,fail){' +
    'var ctl=window.AbortController?new AbortController():null;' +
    'var timer=setTimeout(function(){if(ctl)ctl.abort();},60000);' +
    'fetch(C.endpoint,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(payload),redirect:"follow",signal:ctl?ctl.signal:undefined})' +
    '.then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();})' +
    '.then(function(d){clearTimeout(timer);ok(d||{});},function(e){clearTimeout(timer);fail(e);});' +
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
    'lfBtn.onclick=function(){' +
    'var n=D.getElementById("cb-lead-name").value.trim();' +
    'var em=D.getElementById("cb-lead-email").value.trim();' +
    'if(!n||!em){alert("Please enter name and email.");return;}' +
    'request({type:"lead",name:n,email:em,source:"widget",sessionId:SID,origin:WO},function(d){' +
    'if(d.error){alert(d.error);return;}' +
    'leadDone=true;sSet("cb_lead","1");' +
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
    'var start=Math.max(0,H.length-11);' +
    'for(var i=start;i<H.length-1;i++){priorH.push({role:H[i].role,content:String(H[i].content||"").slice(0,1500)});}' +

    'request({message:txt,history:priorH,sessionId:SID,origin:WO},function(d){' +
    'hideTyping();' +
    'if(d.error||typeof d.response!=="string"){H.pop();lastFailed=txt;appendMsg("error",d.error||"Something went wrong. Please try again.");}' +
    'else{lastFailed="";appendMsg("bot",d.response);H.push({role:"assistant",content:d.response});}' +
    'saveH();' +
    'sending=false;sendBtn.disabled=false;sendBtn.style.opacity="";' +
    '},function(e){' +
    'hideTyping();' +
    'H.pop();' +
    'lastFailed=txt;' +
    'appendMsg("error","Connection error. Please try again.");' +
    'saveH();' +
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
 * @param {string} key - Identifier to rate limit on
 * @param {number} maxRequests - Max requests allowed in window (default: RATE_LIMIT_MAX)
 * @param {number} windowSec - Window in seconds (default: RATE_LIMIT_WINDOW)
 */
function checkRateLimit(key, maxRequests, windowSec) {
  if (!key) key = 'anonymous';
  maxRequests = maxRequests || RATE_LIMIT_MAX;
  windowSec = windowSec || RATE_LIMIT_WINDOW;
  key = String(key).replace(/[^A-Za-z0-9_.-]/g, '').substring(0, 80) || 'anonymous';
  // Fixed window: the bucket id is part of the key. (Re-putting a single key
  // refreshed its TTL on every hit, so a steady stream of requests never let
  // the counter expire and eventually locked everyone out.)
  var bucket = Math.floor(new Date().getTime() / (windowSec * 1000));
  var cacheKey = 'rl_' + key + '_' + windowSec + '_' + bucket;
  var cache = CacheService.getScriptCache();
  var lock = LockService.getScriptLock();
  var locked = false;
  try { locked = lock.tryLock(2000); } catch (e) { /* proceed without lock */ }
  try {
    var count = parseInt(cache.get(cacheKey) || '0', 10) || 0;
    if (count >= maxRequests) {
      return false;
    }
    cache.put(cacheKey, String(count + 1), windowSec + 5);
    return true;
  } finally {
    if (locked) lock.releaseLock();
  }
}

/** Returns "scheme://host[:port]" for a client-supplied origin, or '' if invalid. */
function normalizeOrigin_(origin) {
  var m = /^(https?):\/\/([a-z0-9.-]+)(:\d{1,5})?(?:[\/?#]|$)/i.exec(String(origin || '').trim());
  return m ? (m[1] + '://' + m[2] + (m[3] || '')).toLowerCase() : '';
}

/** Lowercase host without scheme, path or port. */
function hostOf_(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, '').replace(/[\/?#].*$/, '').replace(/:\d+$/, '');
}

/**
 * Builds a fingerprint key from request body for secondary rate limiting.
 * Uses origin + a hash of the session pattern to detect rotation abuse.
 */
function buildFingerprintKey_(body) {
  var host = hostOf_(body.origin);
  return host ? 'fp_' + host : '';
}

/**
 * Validates widget request origin against configured allowedDomains.
 * Returns true if origin is allowed (or if no domains configured = allow all).
 * @param {string} origin - The client-supplied origin (e.g., "https://example.com")
 */
function isOriginAllowed_(origin) {
  var config = getConfigInternal_();
  var allowedDomains = (config.allowedDomains || '').trim();
  // Empty config = allow all (backward compatible)
  if (!allowedDomains) return true;
  // No origin provided but config exists = block
  if (!origin) return false;

  var originHost = hostOf_(normalizeOrigin_(origin));
  if (!originHost) return false;
  var domains = allowedDomains.split(/[,\s]+/);
  for (var i = 0; i < domains.length; i++) {
    var domain = hostOf_(domains[i]).replace(/^\*\./, '');
    if (!domain) continue;
    // Exact match or subdomain match
    if (originHost === domain || originHost.slice(-(domain.length + 1)) === '.' + domain) {
      return true;
    }
  }
  return false;
}
