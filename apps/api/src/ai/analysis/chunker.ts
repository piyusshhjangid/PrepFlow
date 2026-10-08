import { createHash } from 'node:crypto';
import { toNormalizedPages, type SourceKind } from '../../domain/documents/pages.js';
import type { ChunkConfig } from './config.js';
import { CHUNKER_VERSION } from './config.js';

export interface ChunkerMaterial {
  id: string;
  contentHash: string;
  sourceType: SourceKind;
  /** Stored text (pages serialized with pages.ts). */
  extractedText: string;
}

/** A contiguous slice of one page's text. `start`/`end` are offsets into that page's text. */
export interface ChunkSegment {
  page: number | null;
  start: number;
  end: number;
  /** Offset of this segment inside `Chunk.text`. */
  chunkStart: number;
  text: string;
}

export interface Chunk {
  /** Stable: derived from the material's content hash and the chunk's source offsets. */
  id: string;
  materialId: string;
  /** 0-based position within the material. */
  ordinal: number;
  text: string;
  segments: ChunkSegment[];
}

interface RawSegment {
  page: number | null;
  start: number;
  end: number;
  text: string;
  /** Score of the boundary BEFORE this segment: how good a place it is to start a new chunk. */
  boundaryScore: number;
}

const SEGMENT_JOIN = '\n\n';
const HEADING_WORDS = /^(chapter|unit|module|section|part|lecture|topic|appendix)\b/i;
const NUMBERED_HEADING = /^(\d+(\.\d+)*[.)]?|[IVXLC]+[.)])\s+\S/;

/** Higher = better place to begin a new chunk. Purely lexical, so fully deterministic. */
export function headingScore(text: string): number {
  const line = text.trim();
  if (line.length === 0 || line.length > 100 || line.includes('\n')) return 0;
  let score = 0;
  if (HEADING_WORDS.test(line)) score += 4;
  if (NUMBERED_HEADING.test(line)) score += 3;
  const letters = line.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 3 && letters === letters.toUpperCase()) score += 3;
  if (!/[.!?;,]$/.test(line)) score += 1;
  return score >= 3 ? score : 0;
}

/** Splits page text into paragraphs (blank-line separated), keeping source offsets. */
function paragraphs(pageText: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const separator = /\n[ \t]*\n+/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  const push = (start: number, end: number) => {
    let s = start;
    let e = end;
    while (s < e && /\s/.test(pageText[s] ?? '')) s++;
    while (e > s && /\s/.test(pageText[e - 1] ?? '')) e--;
    if (e > s) out.push({ start: s, end: e });
  };
  while ((match = separator.exec(pageText)) !== null) {
    push(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  push(cursor, pageText.length);
  return out;
}

/** Breaks an oversized paragraph at sentence ends, then lines, then whitespace, then hard. */
function splitOversized(
  text: string,
  start: number,
  limit: number,
): { start: number; end: number }[] {
  const pieces: { start: number; end: number }[] = [];
  let from = 0;
  while (text.length - from > limit) {
    const window = text.slice(from, from + limit);
    const candidates = [/[.!?]["')\]]?\s(?=\S)/g, /\n(?=\S)/g, /\s(?=\S)/g];
    let cut = -1;
    for (const pattern of candidates) {
      let m: RegExpExecArray | null;
      let last = -1;
      while ((m = pattern.exec(window)) !== null) last = m.index + m[0].length;
      if (last > limit * 0.5) {
        cut = last;
        break;
      }
    }
    if (cut === -1) cut = limit;
    pieces.push({ start: start + from, end: start + from + cut });
    from += cut;
  }
  pieces.push({ start: start + from, end: start + text.length });
  return pieces.filter((p) => p.end > p.start);
}

function materialSegments(material: ChunkerMaterial, maxSegmentChars: number): RawSegment[] {
  const out: RawSegment[] = [];
  const pages = toNormalizedPages(material.extractedText, material.sourceType);
  let previousPage: number | null | undefined;
  for (const page of pages) {
    let firstOnPage = true;
    for (const para of paragraphs(page.text)) {
      for (const piece of splitOversized(
        page.text.slice(para.start, para.end),
        para.start,
        maxSegmentChars,
      )) {
        const text = page.text.slice(piece.start, piece.end).trim();
        if (!text) continue;
        // A new page is a mildly good boundary (pages often start sections); headings are better.
        const pageBreak = previousPage !== undefined && firstOnPage ? 1 : 0;
        out.push({
          page: page.number,
          start: piece.start,
          end: piece.end,
          text: page.text.slice(piece.start, piece.end),
          boundaryScore: headingScore(text) + pageBreak,
        });
        firstOnPage = false;
      }
    }
    previousPage = page.number;
  }
  return out;
}

function chunkId(material: ChunkerMaterial, first: RawSegment, ordinal: number): string {
  const digest = createHash('sha256')
    .update(
      `${CHUNKER_VERSION}|${material.contentHash}|${ordinal}|${first.page ?? 'x'}:${first.start}`,
    )
    .digest('hex');
  return `c${digest.slice(0, 10)}`;
}

function build(material: ChunkerMaterial, ordinal: number, segs: RawSegment[]): Chunk {
  const segments: ChunkSegment[] = [];
  let text = '';
  for (const seg of segs) {
    if (text) text += SEGMENT_JOIN;
    segments.push({
      page: seg.page,
      start: seg.start,
      end: seg.end,
      chunkStart: text.length,
      text: seg.text,
    });
    text += seg.text;
  }
  return {
    id: chunkId(material, segs[0] as RawSegment, ordinal),
    materialId: material.id,
    ordinal,
    text,
    segments,
  };
}

const length = (segs: RawSegment[]) =>
  segs.reduce((sum, s, i) => sum + s.text.length + (i > 0 ? SEGMENT_JOIN.length : 0), 0);

/**
 * Packs one material's segments into chunks: greedy up to `targetChars`, cutting at the best-scored
 * boundary (a heading or page start) in the last part of the window rather than mid-section.
 */
function packMaterial(material: ChunkerMaterial, config: ChunkConfig): Chunk[] {
  const segments = materialSegments(material, config.targetChars);
  const groups: RawSegment[][] = [];
  let current: RawSegment[] = [];
  const minFill = config.targetChars * 0.5;

  const flushAt = (cutIndex: number) => {
    groups.push(current.slice(0, cutIndex));
    current = current.slice(cutIndex);
  };

  for (const seg of segments) {
    const projected =
      length(current) + (current.length ? SEGMENT_JOIN.length : 0) + seg.text.length;
    if (current.length > 0 && projected > config.targetChars) {
      // Choose the best boundary in the second half of the window; ties go to the later boundary.
      let best = current.length;
      let bestScore = seg.boundaryScore;
      for (let i = 0; i < current.length; i++) {
        if (i === 0) continue;
        const score = (current[i] as RawSegment).boundaryScore;
        const before = length(current.slice(0, i));
        if (before >= minFill && score > bestScore) {
          best = i;
          bestScore = score;
        }
      }
      flushAt(best);
    }
    current.push(seg);
    if (length(current) > config.maxChars) {
      // Cannot happen while segments are <= targetChars <= maxChars, but the cap is a hard invariant.
      throw new Error('chunker invariant violated: chunk exceeds maxChars');
    }
  }
  if (current.length > 0) groups.push(current);

  // Merge a very small tail into the previous chunk when that stays under the hard maximum.
  const tail = groups.at(-1);
  const prev = groups.at(-2);
  if (tail && prev && length(tail) < config.targetChars * 0.25) {
    if (length(prev) + SEGMENT_JOIN.length + length(tail) <= config.maxChars) {
      groups.splice(groups.length - 2, 2, [...prev, ...tail]);
    }
  }
  return groups.map((group, ordinal) => build(material, ordinal, group));
}

/**
 * Deterministic chunking of every material of an exam. Same input and config → identical chunks
 * and ids. Materials are ordered by content hash (not upload time), chunks never cross materials,
 * and there is no overlap between chunks.
 */
export function chunkMaterials(
  materials: readonly ChunkerMaterial[],
  config: ChunkConfig,
): Chunk[] {
  const ordered = [...materials].sort((a, b) =>
    a.contentHash === b.contentHash
      ? a.id.localeCompare(b.id)
      : a.contentHash.localeCompare(b.contentHash),
  );
  return ordered.flatMap((material) => packMaterial(material, config));
}
