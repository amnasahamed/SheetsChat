const fs = require('fs');
const path = require('path');

// Read WebApp.gs and execute it in this context
const code = fs.readFileSync(path.join(__dirname, '../WebApp.gs'), 'utf8');
eval(code);

describe('checkRateLimit', () => {
  let mockCache;

  beforeEach(() => {
    mockCache = {
      store: {},
      get: jest.fn(function(key) { return this.store[key] || null; }),
      put: jest.fn(function(key, value, exp) { this.store[key] = value; }),
    };

    global.CacheService = {
      getScriptCache: jest.fn(() => mockCache)
    };

    // Set globals expected by checkRateLimit
    global.RATE_LIMIT_MAX = 30;
    global.RATE_LIMIT_WINDOW = 60;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('allows requests under the limit', () => {
    const sessionId = 'test-session';
    expect(checkRateLimit(sessionId)).toBe(true);
    expect(mockCache.put).toHaveBeenCalledWith('rl_test-session', '1', 60);
  });

  test('blocks requests over the limit', () => {
    const sessionId = 'test-session';
    mockCache.store['rl_test-session'] = '30';
    expect(checkRateLimit(sessionId)).toBe(false);
    expect(mockCache.put).not.toHaveBeenCalled();
  });

  test('handles missing session id by using anonymous', () => {
    expect(checkRateLimit(null)).toBe(true);
    expect(mockCache.put).toHaveBeenCalledWith('rl_anonymous', '1', 60);
  });

  test('cleans up invalid characters in session id', () => {
    const sessionId = 'test session!@#';
    expect(checkRateLimit(sessionId)).toBe(true);
    expect(mockCache.put).toHaveBeenCalledWith('rl_testsession', '1', 60);
  });

  test('truncates long session ids', () => {
    const longId = 'a'.repeat(100);
    expect(checkRateLimit(longId)).toBe(true);
    expect(mockCache.put).toHaveBeenCalledWith('rl_' + 'a'.repeat(80), '1', 60);
  });

  test('increments existing count correctly', () => {
    const sessionId = 'test-session';
    mockCache.store['rl_test-session'] = '5';
    expect(checkRateLimit(sessionId)).toBe(true);
    expect(mockCache.put).toHaveBeenCalledWith('rl_test-session', '6', 60);
  });
});
