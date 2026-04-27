const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load Providers.gs into the current context
const code = fs.readFileSync(path.join(__dirname, '../Providers.gs'), 'utf8');

// We need a sandbox object to collect the defined globals
const sandbox = {
  UrlFetchApp: {
    fetch: jest.fn()
  }
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

describe('Providers Environment Setup', () => {
  test('PROVIDERS should be defined', () => {
    expect(sandbox.PROVIDERS).toBeDefined();
    expect(sandbox.PROVIDERS.openai).toBeDefined();
  });

  test('getProviders should be defined', () => {
    expect(typeof sandbox.getProviders).toBe('function');
  });
});

describe('buildOpenAIPayload', () => {
  const { buildOpenAIPayload } = sandbox;

  test('should construct payload with messages without systemPrompt', () => {
    const messages = [{ role: 'user', content: 'Hello' }];
    const payload = buildOpenAIPayload('openai', 'gpt-4o', messages, '', 0.7, 1024, 1.0);

    expect(payload.model).toBe('gpt-4o');
    expect(payload.temperature).toBe(0.7);
    expect(payload.top_p).toBe(1.0);
    expect(payload.messages).toEqual([
      { role: 'user', content: 'Hello' }
    ]);
  });

  test('should include systemPrompt when provided', () => {
    const messages = [{ role: 'user', content: 'Hello' }];
    const payload = buildOpenAIPayload('openai', 'gpt-4o', messages, 'You are a helpful assistant', 0.7, 1024, 1.0);

    expect(payload.messages).toEqual([
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: 'Hello' }
    ]);
  });

  test('should use max_completion_tokens for openai', () => {
    const payload = buildOpenAIPayload('openai', 'gpt-4o', [], '', 0.7, 1024, 1.0);
    expect(payload.max_completion_tokens).toBe(1024);
    expect(payload.max_tokens).toBeUndefined();
  });

  test('should use max_tokens for other providers', () => {
    const payload = buildOpenAIPayload('openrouter', 'gpt-4o', [], '', 0.7, 1024, 1.0);
    expect(payload.max_tokens).toBe(1024);
    expect(payload.max_completion_tokens).toBeUndefined();
  });
});

describe('buildAnthropicPayload', () => {
  const { buildAnthropicPayload } = sandbox;

  test('should construct payload and omit system messages from chatMessages', () => {
    const messages = [
      { role: 'system', content: 'You are an AI' },
      { role: 'user', content: 'Hello' }
    ];
    const payload = buildAnthropicPayload('claude-3-5-haiku-20241022', messages, 'You are an AI', 0.5, 500, 0.9);

    expect(payload.model).toBe('claude-3-5-haiku-20241022');
    expect(payload.max_tokens).toBe(500);
    expect(payload.temperature).toBe(0.5);
    expect(payload.top_p).toBe(0.9);
    expect(payload.system).toBe('You are an AI');
    expect(payload.messages).toEqual([
      { role: 'user', content: 'Hello' }
    ]);
  });

  test('should omit top_p for claude-opus-4-1-20250805', () => {
    const payload = buildAnthropicPayload('claude-opus-4-1-20250805', [], '', 0.5, 500, 0.9);

    expect(payload.top_p).toBeUndefined();
  });

  test('should not include system key if systemPrompt is empty', () => {
    const payload = buildAnthropicPayload('claude-3-5-haiku-20241022', [], '', 0.5, 500, 0.9);

    expect(payload.system).toBeUndefined();
  });
});

describe('buildGeminiPayload', () => {
  const { buildGeminiPayload } = sandbox;

  test('should map messages cleanly into contents and parts format', () => {
    const messages = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' }
    ];
    const payload = buildGeminiPayload(messages, '', 0.3, 2048, 0.8);

    expect(payload.contents).toEqual([
      { role: 'user', parts: [{ text: 'Hi' }] },
      { role: 'model', parts: [{ text: 'Hello' }] }
    ]);
  });

  test('should map generationConfig properties properly', () => {
    const payload = buildGeminiPayload([], '', 0.3, 2048, 0.8);

    expect(payload.generationConfig).toEqual({
      temperature: 0.3,
      maxOutputTokens: 2048,
      topP: 0.8
    });
  });

  test('should include systemInstruction when systemPrompt is provided', () => {
    const payload = buildGeminiPayload([], 'You are Gemini', 0.3, 2048, 0.8);

    expect(payload.systemInstruction).toEqual({
      parts: [{ text: 'You are Gemini' }]
    });
  });

  test('should omit systemInstruction when systemPrompt is empty', () => {
    const payload = buildGeminiPayload([], '', 0.3, 2048, 0.8);

    expect(payload.systemInstruction).toBeUndefined();
  });
});

describe('buildCoherePayload', () => {
  const { buildCoherePayload } = sandbox;

  test('should construct payload without systemPrompt', () => {
    const messages = [{ role: 'user', content: 'Sup' }];
    const payload = buildCoherePayload('command-r-plus', messages, '', 0.8, 150, 1.0);

    expect(payload.model).toBe('command-r-plus');
    expect(payload.temperature).toBe(0.8);
    expect(payload.max_tokens).toBe(150);
    expect(payload.messages).toEqual([
      { role: 'user', content: 'Sup' }
    ]);
  });

  test('should map systemPrompt to system role message', () => {
    const messages = [{ role: 'user', content: 'Sup' }];
    const payload = buildCoherePayload('command-r-plus', messages, 'You are Cohere', 0.8, 150, 1.0);

    expect(payload.messages).toEqual([
      { role: 'system', content: 'You are Cohere' },
      { role: 'user', content: 'Sup' }
    ]);
  });
});

describe('parseProviderResponse', () => {
  const { parseProviderResponse } = sandbox;

  test('should parse openai format successfully', () => {
    const data = {
      choices: [{ message: { content: 'OpenAI response' } }]
    };
    expect(parseProviderResponse(data, 'openai')).toBe('OpenAI response');
  });

  test('should throw on unexpected openai format', () => {
    const data = {};
    expect(() => parseProviderResponse(data, 'openai')).toThrow('Unexpected OpenAI response format');
  });

  test('should parse anthropic format successfully', () => {
    const data = {
      content: [{ text: 'Anthropic response' }]
    };
    expect(parseProviderResponse(data, 'anthropic')).toBe('Anthropic response');
  });

  test('should throw on unexpected anthropic format', () => {
    const data = {};
    expect(() => parseProviderResponse(data, 'anthropic')).toThrow('Unexpected Anthropic response format');
  });

  test('should parse gemini format successfully', () => {
    const data = {
      candidates: [{ content: { parts: [{ text: 'Gemini response' }] } }]
    };
    expect(parseProviderResponse(data, 'gemini')).toBe('Gemini response');
  });

  test('should throw on unexpected gemini format', () => {
    const data = {};
    expect(() => parseProviderResponse(data, 'gemini')).toThrow('Unexpected Gemini response format');
  });

  test('should parse cohere format successfully', () => {
    const data = {
      message: { content: [{ text: 'Cohere response' }] }
    };
    expect(parseProviderResponse(data, 'cohere')).toBe('Cohere response');
  });

  test('should throw on unexpected cohere format', () => {
    const data = {};
    expect(() => parseProviderResponse(data, 'cohere')).toThrow('Unexpected Cohere response format');
  });

  test('should throw on unknown body format', () => {
    const data = {};
    expect(() => parseProviderResponse(data, 'unknown_format')).toThrow('Unknown body format: unknown_format');
  });
});
