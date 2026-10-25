/**
 * Pulls the first JSON object out of a model reply that may be wrapped in prose or code fences and may
 * contain trailing commas. Returns undefined when nothing parseable is found. Never throws.
 */
export function extractJsonObject(raw: string): unknown {
  const text = raw.replace(/```(?:json)?/gi, ' ');
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const end = balancedEnd(text, start);
    if (end === -1) continue;
    const candidate = text.slice(start, end + 1);
    for (const attempt of [candidate, candidate.replace(/,\s*([}\]])/g, '$1')]) {
      try {
        const value: unknown = JSON.parse(attempt);
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
      } catch {
        // try the next candidate
      }
    }
  }
  return undefined;
}

function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Last resort for a reply that is not valid JSON as a whole (typically cut off by the output limit): finds the
 * `"topics"` array and returns every complete `{…}` object in it, in order. Never throws; an object that is
 * itself incomplete is skipped.
 */
export function salvageTopicObjects(raw: string): unknown[] {
  const text = raw.replace(/```(?:json)?/gi, ' ');
  const key = /"topics"\s*:\s*\[/.exec(text);
  if (!key) return [];
  const found: unknown[] = [];
  let i = key.index + key[0].length;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const close = balancedEnd(text, open);
    if (close === -1) break;
    const candidate = text.slice(open, close + 1);
    for (const attempt of [candidate, candidate.replace(/,\s*([}\]])/g, '$1')]) {
      try {
        const value: unknown = JSON.parse(attempt);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          found.push(value);
          break;
        }
      } catch {
        // try the next form
      }
    }
    i = close + 1;
  }
  return found;
}
