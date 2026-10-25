import { verifyQuote } from '../src/core/evidence';
import { normalizeWithMap } from '../src/core/evidence';

/**
 * Measures the evidence verifier against synthetic quotes whose correct verdict is known by construction.
 * "accept" classes are harmless differences a real PDF or model reply introduces; "reject" classes are
 * ways a model's quote can be wrong. Accuracy here is agreement with those known verdicts, over sentences
 * taken from the evaluation samples.
 */
export interface MutationClass {
  id: string;
  expect: 'accept' | 'reject';
  description: string;
}

export const CLASSES: MutationClass[] = [
  { id: 'exact', expect: 'accept', description: 'the sentence unchanged' },
  { id: 'noise', expect: 'accept', description: 'upper case, doubled spaces, curly apostrophes' },
  {
    id: 'hyphenated',
    expect: 'accept',
    description: 'source has a word split across a line break with a hyphen',
  },
  {
    id: 'trimmed',
    expect: 'accept',
    description: 'first two words dropped (still one contiguous passage)',
  },
  { id: 'word-changed', expect: 'reject', description: 'one middle word replaced' },
  { id: 'words-swapped', expect: 'reject', description: 'two adjacent words swapped' },
  {
    id: 'spliced',
    expect: 'reject',
    description: 'first half of one sentence + second half of another',
  },
  { id: 'ellipsis', expect: 'reject', description: 'beginning … end of one sentence' },
  { id: 'appended', expect: 'reject', description: 'a plausible extra clause added' },
];

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.split(/\s+/).length >= 6 && s.length <= 300);
}

export interface MutationResult {
  id: string;
  expect: 'accept' | 'reject';
  n: number;
  accepted: number;
  /** Agreement with the known verdict. */
  correct: number;
}

export function runMutations(materials: string[]): MutationResult[] {
  const tally = new Map<string, MutationResult>(
    CLASSES.map((c) => [c.id, { id: c.id, expect: c.expect, n: 0, accepted: 0, correct: 0 }]),
  );
  const record = (id: string, accepted: boolean) => {
    const r = tally.get(id)!;
    const c = CLASSES.find((x) => x.id === id)!;
    r.n++;
    if (accepted) r.accepted++;
    if (accepted === (c.expect === 'accept')) r.correct++;
  };
  for (const source of materials) {
    const sents = sentences(source);
    const prepared = normalizeWithMap(source);
    const inSource = (q: string) => prepared.norm.includes(normalizeWithMap(q).norm);
    const ok = (q: string, src = source) => verifyQuote(q, src).ok;
    sents.forEach((s, i) => {
      const words = s.split(' ');
      record('exact', ok(s));
      record('noise', ok(s.toUpperCase().replace(/ /g, '  ').replace(/'/g, '’')));
      const long = words.findIndex((w) => /^[A-Za-z]{7,}$/.test(w));
      if (long !== -1) {
        const w = words[long]!;
        const split = [...words];
        split[long] = `${w.slice(0, 4)}-\n${w.slice(4)}`;
        record('hyphenated', ok(s, source.replace(s, split.join(' '))));
      }
      if (words.length >= 7) record('trimmed', ok(words.slice(2).join(' ')));
      const mid = Math.floor(words.length / 2);
      const changed = [...words];
      changed[mid] = 'banana';
      if (!inSource(changed.join(' '))) record('word-changed', ok(changed.join(' ')));
      const swapped = [...words];
      [swapped[mid], swapped[mid + 1]] = [swapped[mid + 1]!, swapped[mid]!];
      if (swapped[mid] !== words[mid] && !inSource(swapped.join(' ')))
        record('words-swapped', ok(swapped.join(' ')));
      const other = sents[(i + Math.floor(sents.length / 2) + 1) % sents.length]!;
      const ow = other.split(' ');
      const spliced = `${words.slice(0, mid).join(' ')} ${ow.slice(Math.floor(ow.length / 2)).join(' ')}`;
      if (other !== s && !inSource(spliced)) record('spliced', ok(spliced));
      record('ellipsis', ok(`${words.slice(0, 3).join(' ')} ... ${words.slice(-3).join(' ')}`));
      const appended = `${s.replace(/[.!?]$/, '')} and this is also examined in detail every year.`;
      if (!inSource(appended)) record('appended', ok(appended));
    });
  }
  return [...tally.values()];
}
