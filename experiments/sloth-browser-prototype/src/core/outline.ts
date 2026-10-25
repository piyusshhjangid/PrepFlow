import type { RawTopic } from '../ai/schema';
import { verifyQuote } from './evidence';
import { BULLET, LABELLED, MARKDOWN_HEADING } from './lines';
import { findImportanceCue } from './support';
import { normalizeName } from './topics';
import type { Effort } from './types';

/**
 * Outline mode: topics found by plain rules, with no model. It exists for two reasons.
 *  1. Recovery: when the local model is missing, too slow or returns nothing usable, the student can still
 *     get a plan. The result is always labelled as rule-based, never as model output.
 *  2. A fair baseline: the evaluation compares Gemma with this extractor on the same materials.
 *
 * It only recognises structure the author wrote down: "Week 3 - Joins. …", "Section 2: …", numbered or
 * bulleted items, markdown headings and short heading lines followed by a paragraph. Prose with no
 * headings (lecture notes) yields little, which is exactly where a language model should help.
 */

const MAX_TOPICS = 40;
const MAX_EVIDENCE = 300;
const MAX_NAME_WORDS = 8;

/** Entries that are logistics, not things to study. */
const NOT_A_TOPIC =
  /\b(guest lecture|office hours?|holiday|reading week|no class|attendance|review session|revision session|exam topics|to be announced|tba|details to follow|marks breakdown|assessment|textbook|background reading|bring questions)\b/i;

interface Line {
  text: string;
  start: number;
}

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let pos = 0;
  for (const raw of text.split('\n')) {
    const lead = raw.length - raw.trimStart().length;
    out.push({ text: raw.trim(), start: pos + lead });
    pos += raw.length + 1;
  }
  return out;
}

function clip(text: string): string {
  if (text.length <= MAX_EVIDENCE) return text;
  const cut = text.slice(0, MAX_EVIDENCE);
  const sentence = cut.lastIndexOf('. ');
  const at = sentence > 60 ? sentence + 1 : cut.lastIndexOf(' ');
  return cut.slice(0, at > 0 ? at : MAX_EVIDENCE).trim();
}

function firstSentence(text: string): string {
  const m = /^(.{20,}?[.!?])(?:\s|$)/.exec(text);
  return clip(m ? m[1]! : text);
}

function nameFrom(rest: string): string {
  const head = rest.split(/(?<=[.!?:;])\s|\s[-–—]\s/)[0]!.replace(/[.:;,\s]+$/, '');
  const words = head.split(/\s+/);
  const name = words.slice(0, MAX_NAME_WORDS).join(' ');
  return name.length > 100 ? name.slice(0, 100).trim() : name;
}

const effortFor = (chars: number): Effort =>
  chars < 350 ? 'short' : chars < 1000 ? 'medium' : 'long';

export function extractOutline(text: string): RawTopic[] {
  const lines = linesOf(text);
  interface Hit {
    name: string;
    evidence: string;
    lineIndex: number;
  }
  const hits: Hit[] = [];
  let firstContent = true;
  const nextContent = (i: number): { line: Line; index: number } | null => {
    for (let j = i + 1; j < lines.length; j++)
      if (lines[j]!.text) return { line: lines[j]!, index: j };
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.text) continue;
    const isFirst = firstContent;
    firstContent = false;
    const labelled = LABELLED.exec(line.text) ?? BULLET.exec(line.text);
    if (labelled) {
      const name = nameFrom(labelled[1]!);
      if (name) hits.push({ name, evidence: clip(line.text), lineIndex: i });
      continue;
    }
    const markdown = MARKDOWN_HEADING.exec(line.text);
    const headingLike =
      !isFirst &&
      !/[.!?:;,]$/.test(line.text) &&
      line.text.split(/\s+/).length <= 7 &&
      line.text.length <= 60 &&
      /^[\p{Lu}\d]/u.test(line.text);
    if (markdown || headingLike) {
      if (isFirst) continue; // the first line is normally the document title
      const next = nextContent(i);
      if (!next || next.line.text.length < 40 || LABELLED.test(next.line.text)) continue;
      const name = nameFrom(markdown ? markdown[1]! : line.text);
      if (name) hits.push({ name, evidence: firstSentence(next.line.text), lineIndex: next.index });
    }
  }

  const seen = new Set<string>();
  const topics: RawTopic[] = [];
  hits.forEach((hit, n) => {
    const key = normalizeName(hit.name);
    if (!key || seen.has(key) || NOT_A_TOPIC.test(hit.name) || NOT_A_TOPIC.test(hit.evidence))
      return;
    // Only keep entries whose passage the same verifier the app uses would accept.
    const check = verifyQuote(hit.evidence, text);
    if (!check.ok) return;
    seen.add(key);
    const nextStart = hits[n + 1] ? lines[hits[n + 1]!.lineIndex]!.start : text.length;
    const sectionChars = Math.max(0, nextStart - check.evidence.start);
    const cue = findImportanceCue(text, check.evidence.start, check.evidence.end, hit.name);
    topics.push({
      name: hit.name,
      description: '',
      evidence: hit.evidence,
      effort: effortFor(sectionChars),
      difficulty: 2,
      importance: cue ? 'high' : 'medium',
      prerequisites: [],
    });
  });
  return topics.slice(0, MAX_TOPICS);
}
