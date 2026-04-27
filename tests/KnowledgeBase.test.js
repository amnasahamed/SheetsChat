const { _computeRelevance } = require('../KnowledgeBase.gs');

describe('_computeRelevance', () => {
  it('should return 0 when userWords is empty', () => {
    const userWords = [];
    const question = 'What is the pricing?';
    const answer = 'It costs $10.';
    const keywords = 'pricing, cost';
    expect(_computeRelevance(userWords, question, answer, keywords)).toBe(0);
  });

  it('should add 5 points for an exact keyword match', () => {
    const userWords = ['pricing'];
    const question = 'How much does it cost?';
    const answer = 'It is $10.';
    const keywords = 'pricing, cost'; // Split gives ['pricing', 'cost']
    // Exact match gives 5 points.
    // However, does "pricing" match "pricing,"? The regex is split(/[,\s]+/), which handles "pricing,".
    expect(_computeRelevance(userWords, question, answer, keywords)).toBe(5);
  });

  it('should add 2 points for a partial keyword match (length > 3)', () => {
    const userWords = ['price'];
    const question = 'How much?';
    const answer = 'It is $10.';
    // "prices" length is > 3, "prices".indexOf("price") !== -1
    const keywords = 'prices, cost';
    expect(_computeRelevance(userWords, question, answer, keywords)).toBe(2);
  });

  it('should add 3 points for a question match', () => {
    const userWords = ['cost'];
    const question = 'How much does it cost?';
    const answer = 'It is $10.';
    const keywords = 'pricing';
    expect(_computeRelevance(userWords, question, answer, keywords)).toBe(3);
  });

  it('should add 1 point for an answer match', () => {
    const userWords = ['10'];
    const question = 'How much does it cost?';
    const answer = 'It is $10.';
    const keywords = 'pricing';
    expect(_computeRelevance(userWords, question, answer, keywords)).toBe(1);
  });

  it('should add multi-word bonus when matchCount >= 2', () => {
    // Both 'pricing' and 'cost' are in keywords and/or question.
    // 'pricing' is exact keyword match (5 points) + in keywords (matchCount +1)
    // 'cost' is question match (3 points) + in question (matchCount +1)
    // Score = 5 + 3 = 8
    // matchCount = 2, Bonus = 2 * 2 = 4
    // Total = 8 + 4 = 12
    const userWords = ['pricing', 'cost'];
    const question = 'How much does it cost?';
    const answer = 'It is $10.';
    const keywords = 'pricing';
    expect(_computeRelevance(userWords, question, answer, keywords)).toBe(12);
  });

  it('should accumulate points when multiple conditions are met', () => {
    // 'pricing' exact keyword match (5 points) + question match (3) + answer match (1)
    // Total score for 'pricing': 5 + 3 + 1 = 9
    // matchCount = 1 (no bonus)
    // Total = 9
    const userWords = ['pricing'];
    const question = 'pricing query';
    const answer = 'pricing is $10';
    const keywords = 'pricing';
    expect(_computeRelevance(userWords, question, answer, keywords)).toBe(9);
  });
});
