/**
 * Whitelist-based HTML sanitizer for safe rendering of agent-generated content.
 * Strips dangerous elements (script, iframe), event handler attributes,
 * and javascript:/data: URI schemes while preserving safe formatting elements.
 *
 * Requirements: 8.4, 8.5
 */

/** Allowed HTML elements whitelist */
const ALLOWED_ELEMENTS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'ul', 'ol', 'li', 'code', 'pre',
  'a', 'em', 'strong',
]);

/** Allowed attributes per element (only 'a' gets 'href') */
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href']),
};

/**
 * Remove script tags and their content entirely.
 * Handles variations: <script>, <SCRIPT>, <script type="...">, etc.
 */
function removeScriptTags(html: string): string {
  // Remove <script>...</script> blocks (including content)
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
}

/**
 * Remove iframe tags (self-closing and open/close pairs).
 */
function removeIframeTags(html: string): string {
  // Remove <iframe>...</iframe> blocks
  let result = html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '');
  // Remove self-closing <iframe ... /> or unclosed <iframe ...>
  result = result.replace(/<iframe\b[^>]*\/?>/gi, '');
  return result;
}

/**
 * Check if a URI is dangerous (javascript: or data: scheme).
 */
function isDangerousUri(uri: string): boolean {
  const normalized = uri.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
  return normalized.startsWith('javascript:') || normalized.startsWith('data:');
}

/**
 * Parse attributes from an opening tag string and return only safe ones.
 * For 'a' elements, validates href is not a dangerous URI.
 */
function sanitizeAttributes(tagName: string, attributeString: string): string {
  const allowedAttrs = ALLOWED_ATTRIBUTES[tagName];
  if (!allowedAttrs || !attributeString.trim()) {
    return '';
  }

  const safeAttrs: string[] = [];
  // Match attribute patterns: name="value", name='value', name=value, or bare name
  const attrRegex = /([a-zA-Z][a-zA-Z0-9\-_]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>'"]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(attributeString)) !== null) {
    const attrName = match[1].toLowerCase();
    const attrValue = match[2] ?? match[3] ?? match[4] ?? '';

    // Skip event handler attributes (any attribute starting with "on")
    if (attrName.startsWith('on')) {
      continue;
    }

    // Only allow whitelisted attributes
    if (!allowedAttrs.has(attrName)) {
      continue;
    }

    // For href, check for dangerous URI schemes
    if (attrName === 'href' && isDangerousUri(attrValue)) {
      continue;
    }

    safeAttrs.push(`${attrName}="${attrValue}"`);
  }

  return safeAttrs.length > 0 ? ' ' + safeAttrs.join(' ') : '';
}

/**
 * Process an individual HTML tag, keeping only whitelisted elements
 * with sanitized attributes.
 */
function processTag(fullMatch: string, isClosing: boolean, tagName: string, attributeString: string): string {
  const lowerTagName = tagName.toLowerCase();

  // If not in whitelist, strip the tag (content between tags is preserved by the regex)
  if (!ALLOWED_ELEMENTS.has(lowerTagName)) {
    return '';
  }

  // Closing tags have no attributes
  if (isClosing) {
    return `</${lowerTagName}>`;
  }

  // Sanitize attributes for allowed elements
  const safeAttrs = sanitizeAttributes(lowerTagName, attributeString || '');
  return `<${lowerTagName}${safeAttrs}>`;
}

/**
 * Sanitize HTML string using a whitelist approach.
 * Strips dangerous content while preserving safe formatting elements.
 *
 * @param html - Raw HTML string to sanitize
 * @returns Sanitized HTML with only allowed elements and attributes
 */
export function sanitizeHtml(html: string): string {
  if (!html) {
    return '';
  }

  // Step 1: Remove script tags and their content
  let result = removeScriptTags(html);

  // Step 2: Remove iframe tags
  result = removeIframeTags(result);

  // Step 3: Process remaining HTML tags
  // Match opening tags: <tagname ...> and closing tags: </tagname>
  result = result.replace(
    /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,
    (fullMatch, slash, tagName, attrs) => {
      return processTag(fullMatch, slash === '/', tagName, attrs);
    }
  );

  return result;
}
