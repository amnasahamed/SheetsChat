/**
 * Providers.gs - AI Provider Registry and API Call Logic
 *
 * Contains the PROVIDERS registry with 10 providers + custom,
 * and the callAI() function that handles 4 body formats:
 * openai, anthropic, gemini, cohere.
 */

var PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'openai'
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-opus-4-1-20250805', 'claude-sonnet-4-20250514'],
    authHeader: 'x-api-key',
    authPrefix: '',
    bodyFormat: 'anthropic',
    extraHeaders: { 'anthropic-version': '2023-06-01' }
  },
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    authHeader: 'x-goog-api-key',
    authPrefix: '',
    bodyFormat: 'gemini'
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    models: ['openai/gpt-5.2', 'anthropic/claude-opus-4.1', 'google/gemini-2.5-flash', 'meta-llama/llama-4-maverick'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'openai'
  },
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'openai'
  },
  mistral: {
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1/chat/completions',
    models: ['mistral-large-latest', 'mistral-small-latest'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'openai'
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'openai'
  },
  cohere: {
    name: 'Cohere',
    baseUrl: 'https://api.cohere.com/v2/chat',
    models: ['command-a-03-2025', 'command-r-plus'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'cohere'
  },
  together: {
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1/chat/completions',
    models: ['meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'openai'
  },
  fireworks: {
    name: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1/chat/completions',
    models: ['accounts/fireworks/models/llama-v3p3-70b-instruct', 'accounts/fireworks/models/llama-v3p1-8b-instruct'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'openai'
  },
  custom: {
    name: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    models: [],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    bodyFormat: 'openai'
  }
};

/**
 * Returns provider names and available models for UI population.
 * @returns {Object} Map of provider key -> { name, models }
 */
function getProviders() {
  var result = {};
  for (var key in PROVIDERS) {
    result[key] = { name: PROVIDERS[key].name, models: PROVIDERS[key].models };
  }
  return result;
}

/**
 * Error whose `userMessage` is safe to show to the chat user / site visitor.
 * Provider response bodies are only written to the server log.
 */
function providerError_(userMessage, logDetail) {
  if (logDetail) console.error(logDetail);
  var err = new Error(userMessage);
  err.userMessage = userMessage;
  return err;
}

/** OpenAI reasoning models (gpt-5 family, o-series) reject temperature/top_p. */
function isOpenAIReasoningModel_(model) {
  return /^(gpt-5|o\d)/i.test(String(model || ''));
}

/**
 * Calls an AI provider API with the given config, message, and conversation history.
 *
 * @param {Object} config - Bot configuration from getConfigInternal_()
 * @param {string} message - The new user message
 * @param {Array} history - Previous { role, content } messages (already sanitized)
 * @param {string=} systemPromptOverride - System prompt incl. knowledge base context
 * @returns {Object} { response: string, model: string }
 */
function callAI(config, message, history, systemPromptOverride) {
  var providerKey = config.provider || 'openai';
  var provider = PROVIDERS[providerKey];
  if (!provider) {
    throw providerError_('Unknown AI provider "' + providerKey + '". Pick one in the Provider tab.');
  }

  var apiKey = config.apiKey || '';
  var model = String(config.model || provider.models[0] || '').trim();
  if (!model) {
    throw providerError_('No model selected. Choose a model in the Provider tab.');
  }
  var systemPrompt = systemPromptOverride !== undefined ? systemPromptOverride : (config.systemPrompt || '');
  var params = {
    model: model,
    temperature: toNumber_(config.temperature, 0.7, 0, 2),   // 0 is a valid value
    topP: toNumber_(config.topP, 1, 0, 1),
    maxTokens: Math.round(toNumber_(config.maxTokens, 1024, 1, 64000))
  };

  // History + new message, with roles strictly alternating and starting with "user".
  var messages = mergeSameRoleTurns_((history || []).concat([{ role: 'user', content: message }]));
  while (messages.length && messages[0].role !== 'user') messages.shift();

  var url = provider.baseUrl;
  if (providerKey === 'custom') {
    url = String(config.customBaseUrl || '').trim();
    if (!url) {
      throw providerError_('Custom API URL is missing. Set it in the Provider tab.');
    }
    if (url.indexOf('https://') !== 0) {
      throw providerError_('Custom API URL must use HTTPS.');
    }
  }

  var headers = buildAuthHeaders(provider, apiKey);
  headers['Content-Type'] = 'application/json';
  if (provider.extraHeaders) {
    for (var hk in provider.extraHeaders) headers[hk] = provider.extraHeaders[hk];
  }

  var payload;
  if (provider.bodyFormat === 'openai') {
    payload = buildOpenAIPayload(providerKey, messages, systemPrompt, params);
  } else if (provider.bodyFormat === 'anthropic') {
    payload = buildAnthropicPayload(messages, systemPrompt, params);
  } else if (provider.bodyFormat === 'gemini') {
    url = url.replace('{model}', encodeURIComponent(model));
    payload = buildGeminiPayload(messages, systemPrompt, params);
  } else if (provider.bodyFormat === 'cohere') {
    payload = buildCoherePayload(messages, systemPrompt, params);
  } else {
    throw providerError_('Unsupported provider format.');
  }

  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (fetchErr) {
    throw providerError_('Could not reach the AI provider. Check the API URL and try again.',
      'Fetch failed: ' + fetchErr.message);
  }
  var responseCode = response.getResponseCode();
  var responseText = response.getContentText();

  if (responseCode < 200 || responseCode >= 300) {
    var detail = 'API error (' + responseCode + ') from ' + providerKey + ': ' + responseText.substring(0, 2000);
    if (responseCode === 401 || responseCode === 403) {
      throw providerError_('Invalid API key. Check your key in the Provider tab.', detail);
    }
    if (responseCode === 404) {
      throw providerError_('Model "' + model + '" was not found for this provider. Pick another model.', detail);
    }
    if (responseCode === 429) {
      throw providerError_('Rate limited by the AI provider. Wait a moment and try again.', detail);
    }
    if (responseCode >= 500) {
      throw providerError_('The AI provider is having issues. Please try again shortly.', detail);
    }
    throw providerError_('The AI provider rejected the request (HTTP ' + responseCode + '). Check the model and settings.', detail);
  }

  var data;
  try {
    data = JSON.parse(responseText);
  } catch (parseErr) {
    throw providerError_('The AI service returned an unexpected response. Please try again.',
      'Non-JSON response: ' + responseText.substring(0, 500));
  }
  return { response: parseProviderResponse(data, provider.bodyFormat), model: model };
}

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

/**
 * OpenAI-compatible payload.
 * Used by: openai, openrouter, groq, mistral, deepseek, together, fireworks, custom
 */
function buildOpenAIPayload(providerKey, messages, systemPrompt, params) {
  var allMessages = [];
  if (systemPrompt) allMessages.push({ role: 'system', content: systemPrompt });
  for (var i = 0; i < messages.length; i++) {
    allMessages.push({ role: messages[i].role, content: messages[i].content });
  }
  var payload = { model: params.model, messages: allMessages };

  if (providerKey === 'openai') {
    // OpenAI's own API: max_tokens is deprecated, and reasoning models only
    // accept the default temperature/top_p.
    payload.max_completion_tokens = params.maxTokens;
    if (!isOpenAIReasoningModel_(params.model)) {
      payload.temperature = params.temperature;
      payload.top_p = params.topP;
    }
  } else {
    payload.max_tokens = params.maxTokens;
    payload.temperature = params.temperature;
    payload.top_p = params.topP;
  }
  return payload;
}

/**
 * Anthropic Messages API payload. System prompt is top-level. Newer models
 * reject requests that set both temperature and top_p, so top_p is only sent
 * (instead of temperature) when it has been lowered from the default 1.
 */
function buildAnthropicPayload(messages, systemPrompt, params) {
  var chatMessages = [];
  for (var i = 0; i < messages.length; i++) {
    if (messages[i].role !== 'system') {
      chatMessages.push({ role: messages[i].role, content: messages[i].content });
    }
  }
  var payload = {
    model: params.model,
    messages: chatMessages,
    max_tokens: params.maxTokens
  };
  if (params.topP < 1) {
    payload.top_p = params.topP;
  } else {
    payload.temperature = Math.min(params.temperature, 1); // Anthropic range is 0–1
  }
  if (systemPrompt) payload.system = systemPrompt;
  return payload;
}

/**
 * Google Gemini payload (contents/parts format).
 */
function buildGeminiPayload(messages, systemPrompt, params) {
  var contents = [];
  for (var i = 0; i < messages.length; i++) {
    contents.push({
      role: messages[i].role === 'assistant' ? 'model' : 'user',
      parts: [{ text: messages[i].content }]
    });
  }
  var payload = {
    contents: contents,
    generationConfig: {
      temperature: params.temperature,
      maxOutputTokens: params.maxTokens,
      topP: params.topP
    }
  };
  if (systemPrompt) payload.systemInstruction = { parts: [{ text: systemPrompt }] };
  return payload;
}

/**
 * Cohere v2 payload (OpenAI-style messages; top_p is called "p").
 */
function buildCoherePayload(messages, systemPrompt, params) {
  var allMessages = [];
  if (systemPrompt) allMessages.push({ role: 'system', content: systemPrompt });
  for (var i = 0; i < messages.length; i++) {
    allMessages.push({ role: messages[i].role, content: messages[i].content });
  }
  var payload = {
    model: params.model,
    messages: allMessages,
    temperature: Math.min(params.temperature, 1),
    max_tokens: params.maxTokens
  };
  if (params.topP < 1) payload.p = Math.max(0.01, Math.min(params.topP, 0.99));
  return payload;
}

// ---------------------------------------------------------------------------
// Auth header helpers
// ---------------------------------------------------------------------------

function buildAuthHeaders(provider, apiKey) {
  var headers = {};
  if (provider.authHeader && apiKey) {
    headers[provider.authHeader] = provider.authPrefix + apiKey;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Response parsers
// ---------------------------------------------------------------------------

var TRUNCATED_MSG = 'The AI ran out of output tokens before answering. Increase "Max Tokens" in the Provider tab.';
var EMPTY_MSG = 'The AI returned an empty response. Please try again.';

/** Concatenates text from a list of content blocks, skipping thinking/tool blocks. */
function joinTextBlocks_(blocks, isText) {
  var out = [];
  for (var i = 0; i < (blocks || []).length; i++) {
    var b = blocks[i];
    if (b && typeof b.text === 'string' && isText(b)) out.push(b.text);
  }
  return out.join('').trim();
}

/**
 * Extracts the reply text from a provider response.
 * @param {Object} data - Parsed JSON response
 * @param {string} bodyFormat - One of: openai, anthropic, gemini, cohere
 * @returns {string}
 */
function parseProviderResponse(data, bodyFormat) {
  data = data || {};
  var text = '';
  var truncated = false;

  if (bodyFormat === 'openai') {
    var choice = data.choices && data.choices[0];
    if (!choice || !choice.message) {
      throw providerError_('The AI service returned an unexpected response. Please try again.',
        'Unexpected OpenAI-format response: ' + JSON.stringify(data).substring(0, 500));
    }
    var content = choice.message.content;
    if (Array.isArray(content)) {
      text = joinTextBlocks_(content, function() { return true; });
    } else {
      text = String(content || '').trim();
    }
    truncated = choice.finish_reason === 'length';
    if (!text && choice.message.refusal) {
      return String(choice.message.refusal);
    }
  } else if (bodyFormat === 'anthropic') {
    if (!Array.isArray(data.content)) {
      throw providerError_('The AI service returned an unexpected response. Please try again.',
        'Unexpected Anthropic response: ' + JSON.stringify(data).substring(0, 500));
    }
    text = joinTextBlocks_(data.content, function(b) { return b.type === 'text'; });
    truncated = data.stop_reason === 'max_tokens';
  } else if (bodyFormat === 'gemini') {
    var cand = data.candidates && data.candidates[0];
    if (!cand) {
      if (data.promptFeedback && data.promptFeedback.blockReason) {
        throw providerError_('The AI provider blocked this message. Please rephrase.',
          'Gemini prompt blocked: ' + data.promptFeedback.blockReason);
      }
      throw providerError_('The AI service returned an unexpected response. Please try again.',
        'Unexpected Gemini response: ' + JSON.stringify(data).substring(0, 500));
    }
    var parts = cand.content && cand.content.parts;
    text = joinTextBlocks_(parts, function(p) { return !p.thought; });
    truncated = cand.finishReason === 'MAX_TOKENS';
    if (!text && (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT')) {
      throw providerError_('The AI provider blocked this response. Please rephrase.');
    }
  } else if (bodyFormat === 'cohere') {
    var msg = data.message;
    if (!msg || !Array.isArray(msg.content)) {
      throw providerError_('The AI service returned an unexpected response. Please try again.',
        'Unexpected Cohere response: ' + JSON.stringify(data).substring(0, 500));
    }
    text = joinTextBlocks_(msg.content, function(b) { return !b.type || b.type === 'text'; });
    truncated = data.finish_reason === 'MAX_TOKENS';
  } else {
    throw providerError_('Unsupported provider format.');
  }

  if (!text) {
    throw providerError_(truncated ? TRUNCATED_MSG : EMPTY_MSG);
  }
  return text;
}
