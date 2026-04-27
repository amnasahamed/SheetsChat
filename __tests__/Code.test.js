const fs = require('fs');
const path = require('path');

// Read the Code.gs file and extract the normalizeWebAppUrl_ function
const code = fs.readFileSync(path.join(__dirname, '../Code.gs'), 'utf8');

// A crude way to extract and evaluate the function in the test environment
const funcMatch = code.match(/function normalizeWebAppUrl_\(url\) \{[\s\S]*?\n\}/);
if (!funcMatch) {
  throw new Error('Could not find normalizeWebAppUrl_ in Code.gs');
}

let testFunc;
eval(`${funcMatch[0]}; testFunc = normalizeWebAppUrl_;`);

describe('normalizeWebAppUrl_', () => {
  it('should trim and return a valid URL ending in /exec', () => {
    const url = 'https://script.google.com/macros/s/AKfycbwXYZ123/exec';
    expect(testFunc(url)).toBe(url);

    // With extra whitespace
    expect(testFunc(`  ${url}  `)).toBe(url);
  });

  it('should trim and return a valid URL ending in /dev', () => {
    const url = 'https://script.google.com/macros/s/AKfycbwXYZ123/dev';
    expect(testFunc(url)).toBe(url);
  });

  it('should handle URLs with query parameters or fragments', () => {
    const urlWithQuery = 'https://script.google.com/macros/s/AKfycbwXYZ123/exec?v=1';
    expect(testFunc(urlWithQuery)).toBe(urlWithQuery);

    const urlWithFragment = 'https://script.google.com/macros/s/AKfycbwXYZ123/exec#home';
    expect(testFunc(urlWithFragment)).toBe(urlWithFragment);
  });

  it('should throw if the URL is missing or empty', () => {
    const expectedError = 'Web App URL is missing. Paste the /exec URL from Deploy > Manage deployments.';
    expect(() => testFunc()).toThrow(expectedError);
    expect(() => testFunc('')).toThrow(expectedError);
    expect(() => testFunc('   ')).toThrow(expectedError);
    expect(() => testFunc(null)).toThrow(expectedError);
    expect(() => testFunc(undefined)).toThrow(expectedError);
  });

  it('should throw if the URL does not match the expected pattern', () => {
    const expectedError = 'Invalid Web App URL. Use the Apps Script URL ending in /exec.';

    const invalidUrls = [
      'https://google.com',
      'http://script.google.com/macros/s/abc/exec', // wrong protocol
      'https://script.google.com/macros/s/abc', // missing /exec or /dev
      'https://script.google.com/macros/s/abc/other', // invalid suffix
      'https://script.google.com/macros/s//exec', // empty id
      'https://script.google.com/macros/abc/exec', // missing /s/
    ];

    invalidUrls.forEach(url => {
      expect(() => testFunc(url)).toThrow(expectedError);
    });
  });
});
