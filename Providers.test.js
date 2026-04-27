const fs = require('fs');
const path = require('path');

// Load the Providers.gs content and evaluate it in the current context
const providersScript = fs.readFileSync(path.join(__dirname, 'Providers.gs'), 'utf8');
eval(providersScript);

describe('buildAnthropicPayload', () => {
  it('filters out system role messages from the messages array', () => {
    const messages = [
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'system', content: 'Another system message' },
    ];

    const payload = buildAnthropicPayload('claude-3-haiku', messages, '', 0.7, 100, 1.0);

    expect(payload.messages).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' }
    ]);
  });

  it('sets systemPrompt as a top-level payload attribute when provided, and omits it when missing', () => {
    // With system prompt
    const payloadWithSystem = buildAnthropicPayload('claude-3-haiku', [], 'System prompt here', 0.7, 100, 1.0);
    expect(payloadWithSystem.system).toBe('System prompt here');

    // Without system prompt (empty string)
    const payloadWithoutSystem1 = buildAnthropicPayload('claude-3-haiku', [], '', 0.7, 100, 1.0);
    expect(payloadWithoutSystem1).not.toHaveProperty('system');

    // Without system prompt (null)
    const payloadWithoutSystem2 = buildAnthropicPayload('claude-3-haiku', [], null, 0.7, 100, 1.0);
    expect(payloadWithoutSystem2).not.toHaveProperty('system');
  });

  it('correctly excludes the top_p parameter if the model is claude-opus-4-1-20250805', () => {
    const payload = buildAnthropicPayload('claude-opus-4-1-20250805', [], '', 0.7, 100, 1.0);
    expect(payload).not.toHaveProperty('top_p');
  });

  it('includes the top_p parameter for other models', () => {
    const payload = buildAnthropicPayload('claude-3-haiku', [], '', 0.7, 100, 0.9);
    expect(payload.top_p).toBe(0.9);
  });
});
