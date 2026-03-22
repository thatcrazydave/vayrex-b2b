/**
 @param {string} text
 @returns {Array<{ type: string, content: string, language: string }>}
 */
export function parseContentSegments(text) {
  if (!text) return [];

  const segments = [];

  const FENCE_RE = /```([a-zA-Z0-9_+#-]*)[^\n]*\n([\s\S]*?)```/g;

  let lastIndex = 0;
  let match;

  while ((match = FENCE_RE.exec(text)) !== null) {
    // Text before this code block
    const textBefore = text.slice(lastIndex, match.index);
    if (textBefore) {
      segments.push({ type: 'text', content: textBefore, language: '' });
    }

    const language = (match[1] || '').toLowerCase().trim();
    const code = (match[2] || '').trimEnd(); // preserve leading whitespace (indentation), trim trailing
    segments.push({ type: 'code', content: code, language });

    lastIndex = match.index + match[0].length;
  }

  // Handle the rest of the string after the last matched fence
  const tail = text.slice(lastIndex);
  if (tail) {
    // Check for an unclosed fence in the tail
    const unclosedIdx = tail.indexOf('```');
    if (unclosedIdx !== -1) {
      const beforeFence = tail.slice(0, unclosedIdx);
      if (beforeFence) {
        segments.push({ type: 'text', content: beforeFence, language: '' });
      }
      // Everything after the opening ``` to end-of-string is treated as code
      const fenceRest = tail.slice(unclosedIdx + 3); // skip the ```
      const langLineEnd = fenceRest.indexOf('\n');
      const language = langLineEnd > -1
        ? fenceRest.slice(0, langLineEnd).trim().toLowerCase()
        : fenceRest.trim().toLowerCase();
      const code = langLineEnd > -1 ? fenceRest.slice(langLineEnd + 1).trimEnd() : '';
      segments.push({ type: 'code', content: code, language });
    } else {
      segments.push({ type: 'text', content: tail, language: '' });
    }
  }

  // Filter out pure-whitespace text segments but always keep code segments (even empty ones)
  return segments.filter(s => s.type === 'code' || s.content.trim() !== '');
}
