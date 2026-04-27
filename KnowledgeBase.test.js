const fs = require('fs');
const vm = require('vm');

// Load the file content
const code = fs.readFileSync('./KnowledgeBase.gs', 'utf8');

// Create a context for the script
const context = vm.createContext({});

// Run the code in the context
vm.runInContext(code, context);

describe('KnowledgeBase', () => {
  describe('_tokenize', () => {
    it('should split text into words and remove stop words', () => {
      const text = 'this is a test of the tokenization system.';
      const tokens = context._tokenize(text);
      expect(tokens).toEqual(['test', 'tokenization', 'system']);
    });

    it('should ignore punctuation and case', () => {
      const text = 'Hello, world! How are YOU?';
      const tokens = context._tokenize(text.toLowerCase());
      expect(tokens).toEqual(['hello', 'world']);
    });

    it('should return empty array for only stop words', () => {
      const text = 'this is a the and or but';
      const tokens = context._tokenize(text);
      expect(tokens).toEqual([]);
    });

    it('should filter out single character words', () => {
      const text = 'a b c d e test x y z';
      const tokens = context._tokenize(text);
      expect(tokens).toEqual(['test']);
    });
  });

  describe('_computeRelevance', () => {
    it('should compute a basic relevance score', () => {
      const userWords = ['hello', 'world'];
      const question = 'hello there';
      const answer = 'the world is round';
      const keywords = 'greeting, planet';

      const score = context._computeRelevance(userWords, question, answer, keywords);
      // 'hello' in question -> +3
      // 'world' in answer -> +1
      expect(score).toBe(4);
    });

    it('should compute higher scores for keyword matches', () => {
      const userWords = ['pricing', 'cost'];
      const question = 'how much does it cost?';
      const answer = 'Our pricing is $10/month.';
      const keywords = 'pricing, fees, cost';

      const score = context._computeRelevance(userWords, question, answer, keywords);
      // 'pricing' is an exact keyword match -> +5
      // 'cost' is an exact keyword match -> +5
      // 'cost' is in question -> +3
      // 'pricing' is in answer -> +1
      // Multi-word bonus: both 'pricing' and 'cost' are in question or keywords -> matchCount=2 -> +4
      expect(score).toBe(18);
    });

    it('should compute partial keyword match score', () => {
      const userWords = ['custom'];
      const question = 'how to do it';
      const answer = 'do it like this';
      const keywords = 'customization';

      const score = context._computeRelevance(userWords, question, answer, keywords);
      // 'customization'.indexOf('custom') is 0. So +2.
      expect(score).toBe(2);
    });

    it('should return 0 when there is no match', () => {
      const userWords = ['apple', 'banana'];
      const question = 'how much does it cost?';
      const answer = 'Our pricing is $10/month.';
      const keywords = 'pricing, fees, cost';

      const score = context._computeRelevance(userWords, question, answer, keywords);
      expect(score).toBe(0);
    });
  });
});
