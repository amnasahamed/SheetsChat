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
    models: ['claude-opus-4-1-20250805', 'claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
    authHeader: 'x-api-key',
    authPrefix: '',
    bodyFormat: 'anthropic',
    extraHeaders: { 'anthropic-version': '2023-06-01' }
  },
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    authHeader: null,
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
 * Calls an AI provider API with the given config, message, and conversation history.
 *
 * @param {Object} config - Bot configuration from getConfig()
 * @param {string} message - The new user message
 * @param {Array} history - Array of previous { role, content } messages
 * @returns {Object} { response: string, model: string }
 */
function callAI(config, message, history, systemPromptOverride) {
  var providerKey = config.provider || 'openai';
  var provider = PROVIDERS[providerKey];

  if (!provider) {
    throw new Error('Unknown provider: ' + providerKey);
  }

  var apiKey = config.apiKey || '';
  var model = config.model || provider.models[0] || '';
  var systemPrompt = systemPromptOverride !== undefined ? systemPromptOverride : (config.systemPrompt || '');
  var temperature = parseFloat(config.temperature) || 0.7;
  var maxTokens = parseInt(config.maxTokens, 10) || 1024;
  var topP = parseFloat(config.topP);
  if (isNaN(topP)) { topP = 1.0; }

  // Build messages array from history + new message
  var messages = [];
  if (history && history.length > 0) {
    for (var i = 0; i < history.length; i++) {
      messages.push({ role: history[i].role, content: history[i].content });
    }
  }
  messages.push({ role: 'user', content: message });

  // Determine base URL (custom provider uses config.customBaseUrl)
  var baseUrl = provider.baseUrl;
  if (providerKey === 'custom' && config.customBaseUrl) {
    baseUrl = String(config.customBaseUrl).trim();
    // Reject non-HTTPS URLs to prevent SSRF
    if (baseUrl && baseUrl.indexOf('https://') !== 0) {
      throw new Error('Custom API URL must use HTTPS.');
    }
  }

  // Build request based on body format
  var url = baseUrl;
  var headers = {};
  var payload = {};

  if (provider.bodyFormat === 'openai') {
    payload = buildOpenAIPayload(providerKey, model, messages, systemPrompt, temperature, maxTokens, topP);
    headers = buildAuthHeaders(provider, apiKey);
    headers['Content-Type'] = 'application/json';
  } else if (provider.bodyFormat === 'anthropic') {
    payload = buildAnthropicPayload(model, messages, systemPrompt, temperature, maxTokens, topP);
    headers = buildAuthHeaders(provider, apiKey);
    headers['Content-Type'] = 'application/json';
    // Add extra headers (anthropic-version etc.)
    if (provider.extraHeaders) {
      for (var hk in provider.extraHeaders) {
        headers[hk] = provider.extraHeaders[hk];
      }
    }
  } else if (provider.bodyFormat === 'gemini') {
    url = baseUrl.replace('{model}', encodeURIComponent(model)).replace('{apiKey}', encodeURIComponent(apiKey));
    payload = buildGeminiPayload(messages, systemPrompt, temperature, maxTokens, topP);
    headers['Content-Type'] = 'application/json';
    // Gemini auth is via URL param, no auth header
  } else if (provider.bodyFormat === 'cohere') {
    payload = buildCoherePayload(model, messages, systemPrompt, temperature, maxTokens, topP);
    headers = buildAuthHeaders(provider, apiKey);
    headers['Content-Type'] = 'application/json';
  }

  var options = {
    method: 'post',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var responseCode = response.getResponseCode();
  var responseText = response.getContentText();

  if (responseCode !== 200) {
    throw new Error('API error (' + responseCode + '): ' + responseText);
  }

  var data = JSON.parse(responseText);
  var resultText = parseProviderResponse(data, provider.bodyFormat);

  return { response: resultText, model: model };
}

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

/**
 * Builds OpenAI-compatible request payload.
 * Used by: openai, openrouter, groq, mistral, deepseek, together, fireworks, custom
 */
function buildOpenAIPayload(providerKey, model, messages, systemPrompt, temperature, maxTokens, topP) {
  var allMessages = [];
  if (systemPrompt) {
    allMessages.push({ role: 'system', content: systemPrompt });
  }
  for (var i = 0; i < messages.length; i++) {
    allMessages.push({ role: messages[i].role, content: messages[i].content });
  }
  var payload = {
    model: model,
    messages: allMessages,
    temperature: temperature,
    max_tokens: maxTokens,
    top_p: topP
  };
  return payload;
}

/**
 * Builds Anthropic request payload.
 * System prompt is a top-level param, not in messages array.
 */
function buildAnthropicPayload(model, messages, systemPrompt, temperature, maxTokens, topP) {
  // Anthropic uses assistant/user roles, filter out system from messages
  var chatMessages = [];
  for (var i = 0; i < messages.length; i++) {
    if (messages[i].role !== 'system') {
      chatMessages.push({ role: messages[i].role, content: messages[i].content });
    }
  }
  var payload = {
    model: model,
    messages: chatMessages,
    max_tokens: maxTokens,
    temperature: temperature
  };
  if (model !== 'claude-opus-4-1-20250805') {
    payload.top_p = topP;
  }
  if (systemPrompt) {
    payload.system = systemPrompt;
  }
  return payload;
}

/**
 * Builds Google Gemini request payload.
 * Uses contents/parts format instead of messages.
 */
function buildGeminiPayload(messages, systemPrompt, temperature, maxTokens, topP) {
  var contents = [];
  for (var i = 0; i < messages.length; i++) {
    var role = messages[i].role === 'assistant' ? 'model' : 'user';
    contents.push({
      role: role,
      parts: [{ text: messages[i].content }]
    });
  }
  var payload = {
    contents: contents,
    generationConfig: {
      temperature: temperature,
      maxOutputTokens: maxTokens,
      topP: topP
    }
  };
  if (systemPrompt) {
    payload.systemInstruction = {
      parts: [{ text: systemPrompt }]
    };
  }
  return payload;
}

/**
 * Builds Cohere v2 request payload.
 * v2 uses OpenAI-style messages format with system/user/assistant roles.
 */
function buildCoherePayload(model, messages, systemPrompt, temperature, maxTokens, topP) {
  var allMessages = [];
  if (systemPrompt) {
    allMessages.push({ role: 'system', content: systemPrompt });
  }
  for (var i = 0; i < messages.length; i++) {
    allMessages.push({ role: messages[i].role, content: messages[i].content });
  }

  var payload = {
    model: model,
    messages: allMessages,
    temperature: temperature,
    max_tokens: maxTokens
  };
  return payload;
}

// ---------------------------------------------------------------------------
// Auth header helpers
// ---------------------------------------------------------------------------

/**
 * Builds authentication headers for a provider.
 * Gemini returns empty (auth is in URL).
 */
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

/**
 * Parses an API response based on provider body format.
 * @param {Object} data - Parsed JSON response
 * @param {string} bodyFormat - One of: openai, anthropic, gemini, cohere
 * @returns {string} The text content of the AI response
 */
function parseProviderResponse(data, bodyFormat) {
  if (bodyFormat === 'openai') {
    // choices[0].message.content
    if (data.choices && data.choices.length > 0 && data.choices[0].message) {
      return data.choices[0].message.content || '';
    }
    throw new Error('Unexpected OpenAI response format');
  }

  if (bodyFormat === 'anthropic') {
    // content[0].text
    if (data.content && data.content.length > 0) {
      return data.content[0].text || '';
    }
    throw new Error('Unexpected Anthropic response format');
  }

  if (bodyFormat === 'gemini') {
    // candidates[0].content.parts[0].text
    if (data.candidates && data.candidates.length > 0 &&
        data.candidates[0].content && data.candidates[0].content.parts &&
        data.candidates[0].content.parts.length > 0) {
      return data.candidates[0].content.parts[0].text || '';
    }
    throw new Error('Unexpected Gemini response format');
  }

  if (bodyFormat === 'cohere') {
    // data.message.content[0].text
    if (data.message && data.message.content && data.message.content.length > 0) {
      return data.message.content[0].text || '';
    }
    throw new Error('Unexpected Cohere response format');
  }

  throw new Error('Unknown body format: ' + bodyFormat);
}
