import { sanitizeHtml } from './sanitizer';

describe('sanitizeHtml', () => {
  describe('allowed elements preservation', () => {
    it('preserves h1-h6 tags', () => {
      expect(sanitizeHtml('<h1>Title</h1>')).toBe('<h1>Title</h1>');
      expect(sanitizeHtml('<h2>Subtitle</h2>')).toBe('<h2>Subtitle</h2>');
      expect(sanitizeHtml('<h6>Small</h6>')).toBe('<h6>Small</h6>');
    });

    it('preserves p, ul, ol, li tags', () => {
      expect(sanitizeHtml('<p>Paragraph</p>')).toBe('<p>Paragraph</p>');
      expect(sanitizeHtml('<ul><li>Item</li></ul>')).toBe('<ul><li>Item</li></ul>');
      expect(sanitizeHtml('<ol><li>First</li></ol>')).toBe('<ol><li>First</li></ol>');
    });

    it('preserves code and pre tags', () => {
      expect(sanitizeHtml('<code>inline</code>')).toBe('<code>inline</code>');
      expect(sanitizeHtml('<pre>block</pre>')).toBe('<pre>block</pre>');
    });

    it('preserves em and strong tags', () => {
      expect(sanitizeHtml('<em>italic</em>')).toBe('<em>italic</em>');
      expect(sanitizeHtml('<strong>bold</strong>')).toBe('<strong>bold</strong>');
    });

    it('preserves a tags with safe href', () => {
      expect(sanitizeHtml('<a href="https://example.com">Link</a>'))
        .toBe('<a href="https://example.com">Link</a>');
    });
  });

  describe('script tag removal', () => {
    it('removes script tags and content', () => {
      expect(sanitizeHtml('<script>alert("xss")</script>')).toBe('');
    });

    it('removes script tags with attributes', () => {
      expect(sanitizeHtml('<script type="text/javascript">alert("xss")</script>')).toBe('');
    });

    it('removes script tags case-insensitively', () => {
      expect(sanitizeHtml('<SCRIPT>alert("xss")</SCRIPT>')).toBe('');
      expect(sanitizeHtml('<Script>alert("xss")</Script>')).toBe('');
    });

    it('removes script tags embedded in content', () => {
      expect(sanitizeHtml('<p>Hello</p><script>evil()</script><p>World</p>'))
        .toBe('<p>Hello</p><p>World</p>');
    });
  });

  describe('iframe tag removal', () => {
    it('removes iframe tags and content', () => {
      expect(sanitizeHtml('<iframe src="evil.html"></iframe>')).toBe('');
    });

    it('removes self-closing iframe tags', () => {
      expect(sanitizeHtml('<iframe src="evil.html"/>')).toBe('');
    });

    it('removes iframe tags case-insensitively', () => {
      expect(sanitizeHtml('<IFRAME src="evil.html"></IFRAME>')).toBe('');
    });
  });

  describe('event handler attribute removal', () => {
    it('strips onclick attributes', () => {
      expect(sanitizeHtml('<a href="https://safe.com" onclick="evil()">Link</a>'))
        .toBe('<a href="https://safe.com">Link</a>');
    });

    it('strips onerror attributes', () => {
      expect(sanitizeHtml('<p onerror="evil()">Text</p>')).toBe('<p>Text</p>');
    });

    it('strips onload attributes', () => {
      expect(sanitizeHtml('<p onload="evil()">Text</p>')).toBe('<p>Text</p>');
    });

    it('strips onmouseover attributes', () => {
      expect(sanitizeHtml('<p onmouseover="evil()">Text</p>')).toBe('<p>Text</p>');
    });

    it('strips all on* attributes from allowed elements', () => {
      const input = '<a href="https://ok.com" onfocus="evil()" onblur="bad()">Link</a>';
      expect(sanitizeHtml(input)).toBe('<a href="https://ok.com">Link</a>');
    });
  });

  describe('dangerous URI removal', () => {
    it('strips javascript: URIs from href', () => {
      expect(sanitizeHtml('<a href="javascript:alert(1)">Click</a>'))
        .toBe('<a>Click</a>');
    });

    it('strips javascript: URIs case-insensitively', () => {
      expect(sanitizeHtml('<a href="JavaScript:alert(1)">Click</a>'))
        .toBe('<a>Click</a>');
    });

    it('strips javascript: URIs with whitespace obfuscation', () => {
      expect(sanitizeHtml('<a href="  javascript:alert(1)">Click</a>'))
        .toBe('<a>Click</a>');
    });

    it('strips data: URIs from href', () => {
      expect(sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">Click</a>'))
        .toBe('<a>Click</a>');
    });
  });

  describe('non-whitelisted element stripping', () => {
    it('strips div tags but keeps content', () => {
      expect(sanitizeHtml('<div>Content</div>')).toBe('Content');
    });

    it('strips span tags but keeps content', () => {
      expect(sanitizeHtml('<span>Content</span>')).toBe('Content');
    });

    it('strips img tags', () => {
      expect(sanitizeHtml('<img src="image.png" onerror="evil()">')).toBe('');
    });

    it('strips non-whitelisted attributes from allowed elements', () => {
      expect(sanitizeHtml('<p class="fancy" id="para">Text</p>'))
        .toBe('<p>Text</p>');
    });
  });

  describe('edge cases', () => {
    it('handles empty string', () => {
      expect(sanitizeHtml('')).toBe('');
    });

    it('handles plain text without HTML', () => {
      expect(sanitizeHtml('Hello World')).toBe('Hello World');
    });

    it('handles nested allowed elements', () => {
      expect(sanitizeHtml('<p><strong>Bold</strong> and <em>italic</em></p>'))
        .toBe('<p><strong>Bold</strong> and <em>italic</em></p>');
    });

    it('handles complex mixed content', () => {
      const input = '<h1>Title</h1><script>evil()</script><p>Safe <a href="https://ok.com">link</a></p>';
      const expected = '<h1>Title</h1><p>Safe <a href="https://ok.com">link</a></p>';
      expect(sanitizeHtml(input)).toBe(expected);
    });
  });
});
