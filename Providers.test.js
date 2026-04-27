const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, 'Providers.gs'), 'utf8');

global.PROVIDERS = undefined;
global.getProviders = undefined;
global.callAI = undefined;
global.buildOpenAIPayload = undefined;
global.buildAnthropicPayload = undefined;
global.buildGeminiPayload = undefined;
global.buildCoherePayload = undefined;
global.buildAuthHeaders = undefined;
global.parseProviderResponse = undefined;
global.UrlFetchApp = { fetch: jest.fn() };

eval(code);

describe('callAI Error Paths', () => {
    beforeEach(() => {
        global.UrlFetchApp.fetch.mockReset();
    });

    it('should throw Error for unknown provider', () => {
        expect(() => {
            callAI({provider: 'unknown_provider'}, 'hello', []);
        }).toThrow('Unknown provider: unknown_provider');
    });

    it('should throw Error for API error (non-200)', () => {
        global.UrlFetchApp.fetch.mockReturnValue({
            getResponseCode: () => 500,
            getContentText: () => 'Internal Server Error'
        });

        expect(() => {
            callAI({provider: 'openai'}, 'hello', []);
        }).toThrow('API error (500): Internal Server Error');
    });

    it('should throw Error for unexpected OpenAI response format', () => {
        global.UrlFetchApp.fetch.mockReturnValue({
            getResponseCode: () => 200,
            getContentText: () => JSON.stringify({ choices: [] }) // Empty choices
        });

        expect(() => {
            callAI({provider: 'openai'}, 'hello', []);
        }).toThrow('Unexpected OpenAI response format');
    });

    it('should throw Error for unexpected Anthropic response format', () => {
        global.UrlFetchApp.fetch.mockReturnValue({
            getResponseCode: () => 200,
            getContentText: () => JSON.stringify({ content: [] }) // Empty content
        });

        expect(() => {
            callAI({provider: 'anthropic'}, 'hello', []);
        }).toThrow('Unexpected Anthropic response format');
    });

    it('should throw Error for unexpected Gemini response format', () => {
        global.UrlFetchApp.fetch.mockReturnValue({
            getResponseCode: () => 200,
            getContentText: () => JSON.stringify({ candidates: [] }) // Empty candidates
        });

        expect(() => {
            callAI({provider: 'gemini'}, 'hello', []);
        }).toThrow('Unexpected Gemini response format');
    });

    it('should throw Error for unexpected Cohere response format', () => {
        global.UrlFetchApp.fetch.mockReturnValue({
            getResponseCode: () => 200,
            getContentText: () => JSON.stringify({ message: {} }) // Missing content
        });

        expect(() => {
            callAI({provider: 'cohere'}, 'hello', []);
        }).toThrow('Unexpected Cohere response format');
    });

    it('should throw Error for unknown bodyFormat', () => {
        // Temporarily modify a provider to have an invalid body format
        const originalFormat = PROVIDERS['openai'].bodyFormat;
        PROVIDERS['openai'].bodyFormat = 'unknown_format';

        global.UrlFetchApp.fetch.mockReturnValue({
            getResponseCode: () => 200,
            getContentText: () => JSON.stringify({}) // Any JSON
        });

        try {
            expect(() => {
                callAI({provider: 'openai'}, 'hello', []);
            }).toThrow('Unknown body format: unknown_format');
        } finally {
            // Restore original provider settings
            PROVIDERS['openai'].bodyFormat = originalFormat;
        }
    });
});
