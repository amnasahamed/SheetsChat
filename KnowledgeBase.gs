// KnowledgeBase.gs — Knowledge Base / RAG System

/**
 * Creates the KnowledgeBase sheet if it doesn't exist.
 * Columns: Category | Question | Answer | Keywords
 */
function ensureKnowledgeSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('KnowledgeBase');
  if (!sheet) {
    sheet = ss.insertSheet('KnowledgeBase');
    var headers = ['Category', 'Question', 'Answer', 'Keywords'];
    sheet.getRange(1, 1, 1, 4).setValues([headers]);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 250);
    sheet.setColumnWidth(3, 400);
    sheet.setColumnWidth(4, 200);
    // Example entries
    var examples = [
      ['Getting Started', 'How do I customize this chatbot?', 'Replace these sample rows with your own questions, answers, and keywords. The chatbot will use this sheet as its knowledge base.', 'customize,setup,knowledge,questions,answers'],
      ['Getting Started', 'What should I add to the knowledge base?', 'Add accurate details about your business, such as hours, pricing, support contacts, policies, product details, and common customer questions.', 'business,hours,pricing,support,faq,policies'],
      ['Getting Started', 'How does keyword matching work?', 'Add comma-separated keywords that visitors might use. More specific keywords help the chatbot find the most relevant answer.', 'keywords,matching,relevance,search']
    ];
    sheet.getRange(2, 1, examples.length, 4).setValues(examples);
  }
  return sheet;
}

/**
 * Returns all knowledge base entries for the sidebar UI.
 */
function getKnowledgeEntries() {
  var data = getKBCachedData_();
  if (!data) data = [];
  var entries = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] || data[i][2]) {
      entries.push({
        row: i + 1,
        category: data[i][0] || '',
        question: data[i][1] || '',
        answer: data[i][2] || '',
        keywords: data[i][3] || ''
      });
    }
  }
  return entries;
}

/**
 * Adds a new entry to the knowledge base.
 */
function addKnowledgeEntry(entry) {
  var sheet = ensureKnowledgeSheet();
  sheet.appendRow([
    entry.category || 'General',
    entry.question || '',
    entry.answer || '',
    entry.keywords || ''
  ]);
  invalidateKBCache_();
  return { success: true };
}

/**
 * Deletes a knowledge base entry by row number.
 */
function deleteKnowledgeEntry(rowNumber) {
  var sheet = ensureKnowledgeSheet();
  if (rowNumber > 1 && rowNumber <= sheet.getLastRow()) {
    sheet.deleteRow(rowNumber);
    invalidateKBCache_();
    return { success: true };
  }
  return { success: false, error: 'Invalid row' };
}

/**
 * Searches the knowledge base and returns relevant context string.
 * Uses weighted keyword matching. Results are cached for 5 minutes.
 */
var KB_CACHE_KEY = 'kb_data_rows';
var KB_CACHE_TTL = 300; // 5 minutes

function getKnowledgeContext(userMessage) {
  var data = getKBCachedData_();
  if (!data || data.length <= 1) return '';

  var userWords = _tokenize(userMessage.toLowerCase());
  if (userWords.length === 0) return '';

  var scored = [];
  for (var i = 1; i < data.length; i++) {
    var question = String(data[i][1] || '').toLowerCase();
    var answer = String(data[i][2] || '').toLowerCase();
    var keywords = String(data[i][3] || '').toLowerCase();
    if (!question && !answer) continue;

    var score = _computeRelevance(userWords, question, answer, keywords);
    if (score > 0) {
      scored.push({
        question: String(data[i][1] || ''),
        answer: String(data[i][2] || ''),
        score: score
      });
    }
  }

  scored.sort(function(a, b) { return b.score - a.score; });
  var topK = scored.slice(0, 3);
  if (topK.length === 0) return '';

  var context = '\n\n--- KNOWLEDGE BASE ---\n';
  for (var j = 0; j < topK.length; j++) {
    context += 'Q: ' + topK[j].question + '\nA: ' + topK[j].answer + '\n\n';
  }
  context += '--- END KNOWLEDGE BASE ---\n';
  context += 'Use the above knowledge base to answer if relevant. If not covered, answer from general knowledge but note it may not be specific to this business.';
  return context;
}

// --- Helpers ---

var _STOP_WORDS = ['the','is','at','which','on','a','an','and','or','but','in','with','to','for','of','not','no','can','will','do','does','did','has','have','had','was','were','be','been','are','am','it','its','this','that','i','you','we','they','he','she','my','your','our','their','what','how','when','where','who','why','me','him','her','us','them','so','if','about','just','get','got'];

function _tokenize(text) {
  return text
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(function(w) { return w.length > 1 && _STOP_WORDS.indexOf(w) === -1; });
}

function _computeRelevance(userWords, question, answer, keywords) {
  var score = 0;
  var keywordList = keywords.split(/[,\s]+/);

  for (var i = 0; i < userWords.length; i++) {
    var word = userWords[i];
    for (var k = 0; k < keywordList.length; k++) {
      if (keywordList[k] === word) { score += 5; break; }
      if (keywordList[k].length > 3 && keywordList[k].indexOf(word) !== -1) { score += 2; break; }
    }
    if (question.indexOf(word) !== -1) score += 3;
    if (answer.indexOf(word) !== -1) score += 1;
  }

  // Bonus for multi-word matches
  var matchCount = 0;
  for (var j = 0; j < userWords.length; j++) {
    if (question.indexOf(userWords[j]) !== -1 || keywords.indexOf(userWords[j]) !== -1) matchCount++;
  }
  if (matchCount >= 2) score += matchCount * 2;

  return score;
}

/**
 * Reads KB data from cache or falls back to sheet read.
 * Cache TTL: 5 minutes.
 */
function getKBCachedData_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(KB_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through */ }
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('KnowledgeBase');
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  try { cache.put(KB_CACHE_KEY, JSON.stringify(data), KB_CACHE_TTL); } catch (e) { /* non-critical */ }
  return data;
}

/**
 * Invalidates the KB data cache. Call on writes.
 */
function invalidateKBCache_() {
  try { CacheService.getScriptCache().remove(KB_CACHE_KEY); } catch (e) { /* non-critical */ }
}
