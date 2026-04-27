const fs = require('fs');

// Load the Google Apps Script file into the Node.js context
const codeGs = fs.readFileSync('./Code.gs', 'utf8');
eval(codeGs);

describe('sanitizeHtml', () => {
  it('should return empty string for null or undefined', () => {
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
  });

  it('should remove normal HTML tags', () => {
    expect(sanitizeHtml('<p>Hello <b>World</b></p>')).toBe('Hello World');
    expect(sanitizeHtml('<a href="https://example.com">Link</a>')).toBe('Link');
    expect(sanitizeHtml('<div><br/>Test</div>')).toBe('Test');
  });

  it('should completely remove script tags and their content', () => {
    expect(sanitizeHtml('<script>alert("hack")</script>Safe Text')).toBe('Safe Text');
    expect(sanitizeHtml('<script type="text/javascript">var x = 1;</script>')).toBe('');
    expect(sanitizeHtml('Before <script>malicious()</script> After')).toBe('Before  After');
  });

  it('should completely remove style tags and their content', () => {
    expect(sanitizeHtml('<style>body { color: red; }</style>Visible')).toBe('Visible');
    expect(sanitizeHtml('Text <style type="text/css">.hidden { display: none; }</style> Here')).toBe('Text  Here');
  });

  it('should remove javascript: protocol strings', () => {
    expect(sanitizeHtml('javascript:alert(1)')).toBe('alert(1)');
    expect(sanitizeHtml('<a href="javascript:void(0)">Click</a>')).toBe('Click');
  });

  it('should trim whitespace from the ends', () => {
    expect(sanitizeHtml('   Hello   ')).toBe('Hello');
    expect(sanitizeHtml(' \n\t  Test \r\n ')).toBe('Test');
  });

  it('should convert numbers/booleans to string and process them', () => {
    expect(sanitizeHtml(12345)).toBe('12345');
    expect(sanitizeHtml(true)).toBe('true');
  });

  it('should handle complex mixed inputs correctly', () => {
    const input = '  <script>evil()</script> <p>Safe <b>HTML</b></p> <style>color:red;</style> javascript:run()  ';
    expect(sanitizeHtml(input)).toBe('Safe HTML  run()');
  });
});
