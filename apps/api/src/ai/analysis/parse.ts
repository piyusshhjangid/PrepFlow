import { z } from 'zod';
import { rawAnalysisSchema, rawSubjectSchema, rawTopicSchema, type RawTopic } from './schema.js';

/** Finds the first balanced top-level JSON object in free text, ignoring braces inside strings. */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i] as string;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null; // unbalanced: likely truncated output
}

function stripFences(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return fenced?.[1] ?? text;
}

/** Light, safe repairs for common model slips: trailing commas and smart quotes around keys are NOT touched. */
function lenientParse(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    // Remove trailing commas before } or ]. Strings containing ",}" are rare enough that a failed
    // re-parse (below) simply leads to a rejected output rather than a wrong one.
    return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
  }
}

export type ParseFailure = 'NO_JSON' | 'INVALID_JSON' | 'WRONG_SHAPE';

export interface ParsedAnalysis {
  topics: { subject: string; topic: RawTopic }[];
  /** Topics/subjects that failed schema validation and were dropped. */
  invalidTopics: number;
  /** Compact reasons for the repair prompt (never includes model text beyond field paths). */
  issues: string[];
}

export type ParseResult =
  { ok: true; value: ParsedAnalysis } | { ok: false; failure: ParseFailure; issues: string[] };

/**
 * raw model text → candidate JSON → parse → Zod. Validation is per topic: one malformed topic is
 * dropped (and counted) instead of discarding a whole otherwise-valid response.
 */
export function parseModelOutput(raw: string): ParseResult {
  const candidate = extractJsonObject(stripFences(raw)) ?? extractJsonObject(raw);
  if (!candidate)
    return { ok: false, failure: 'NO_JSON', issues: ['The response contained no JSON object.'] };
  let json: unknown;
  try {
    json = lenientParse(candidate);
  } catch {
    return { ok: false, failure: 'INVALID_JSON', issues: ['The response was not valid JSON.'] };
  }
  const top = rawAnalysisSchema.safeParse(json);
  if (!top.success)
    return {
      ok: false,
      failure: 'WRONG_SHAPE',
      issues: ['Top-level object must be {"subjects": [...]}.'],
    };

  const topics: ParsedAnalysis['topics'] = [];
  const issues: string[] = [];
  let invalid = 0;
  top.data.subjects.forEach((rawSubject, si) => {
    const subject = rawSubjectSchema.safeParse(rawSubject);
    if (!subject.success) {
      invalid += 1;
      issues.push(`subjects[${si}]: needs a "name" and a "topics" array`);
      return;
    }
    subject.data.topics.forEach((rawTopic, ti) => {
      const topic = rawTopicSchema.safeParse(rawTopic);
      if (topic.success) topics.push({ subject: subject.data.name, topic: topic.data });
      else {
        invalid += 1;
        issues.push(`subjects[${si}].topics[${ti}]: ${summarize(topic.error)}`);
      }
    });
  });
  return { ok: true, value: { topics, invalidTopics: invalid, issues: issues.slice(0, 8) } };
}

function summarize(error: z.ZodError): string {
  return (
    [...new Set(error.issues.map((i) => i.path.join('.') || 'topic'))].slice(0, 5).join(', ') +
    ' invalid'
  );
}
