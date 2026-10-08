import { describe, expect, it } from 'vitest';
import { serializePages } from '../../domain/documents/pages.js';
import { chunkMaterials, headingScore, type ChunkerMaterial } from './chunker.js';

const config = { targetChars: 400, maxChars: 500, maxChunks: 40 };
const para = (word: string, n = 12) =>
  Array.from({ length: n }, () => `${word} lorem ipsum.`).join(' ');

function pdf(id: string, hash: string, pages: string[]): ChunkerMaterial {
  return { id, contentHash: hash, sourceType: 'PDF', extractedText: serializePages(pages) };
}
function text(id: string, hash: string, body: string): ChunkerMaterial {
  return { id, contentHash: hash, sourceType: 'TEXT', extractedText: body };
}

describe('chunkMaterials', () => {
  const material = pdf('m1', 'bbb', [
    `Chapter 1 Basics\n\n${para('alpha')}\n\n${para('beta')}`,
    `${para('gamma')}\n\nCHAPTER 2 ADVANCED\n\n${para('delta')}`,
    `${para('epsilon')}`,
  ]);

  it('is deterministic: same input, same chunks and ids', () => {
    expect(chunkMaterials([material], config)).toEqual(chunkMaterials([material], config));
  });

  it('does not depend on the order materials are passed in', () => {
    const other = text('m2', 'aaa', para('zeta', 30));
    const a = chunkMaterials([material, other], config).map((c) => c.id);
    const b = chunkMaterials([other, material], config).map((c) => c.id);
    expect(a).toEqual(b);
  });

  it('keeps ids stable when only the database id of a material changes', () => {
    const renamed = { ...material, id: 'different-db-id' };
    expect(chunkMaterials([renamed], config).map((c) => c.id)).toEqual(
      chunkMaterials([material], config).map((c) => c.id),
    );
  });

  it('never exceeds the hard maximum and never crosses materials', () => {
    const chunks = chunkMaterials([material, text('m2', 'aaa', para('zeta', 80))], config);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(config.maxChars);
    expect(new Set(chunks.map((c) => c.materialId))).toEqual(new Set(['m1', 'm2']));
    for (const chunk of chunks) {
      const source = chunk.materialId === 'm1' ? material : null;
      if (source) expect(chunk.segments.every((s) => s.page !== null)).toBe(true);
    }
  });

  it('splits an oversized paragraph instead of exceeding the limit', () => {
    const chunks = chunkMaterials([text('m', 'h', para('long', 200))], config);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(config.maxChars);
  });

  it('preserves source offsets: every segment text equals its slice of the page', () => {
    const chunks = chunkMaterials([material], config);
    const pages = material.extractedText.split('\f');
    for (const chunk of chunks)
      for (const seg of chunk.segments) {
        expect(pages[(seg.page as number) - 1]?.slice(seg.start, seg.end)).toBe(seg.text);
        expect(chunk.text.slice(seg.chunkStart, seg.chunkStart + seg.text.length)).toBe(seg.text);
      }
  });

  it('does not overlap: each source segment appears in exactly one chunk', () => {
    const chunks = chunkMaterials([material], config);
    const keys = chunks.flatMap((c) => c.segments.map((s) => `${s.page}:${s.start}`));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('prefers cutting at a heading over mid-section', () => {
    const body = `${para('one', 14)}\n\nCHAPTER 2 NEXT\n\n${para('two', 14)}`;
    const chunks = chunkMaterials([text('m', 'h', body)], {
      targetChars: 450,
      maxChars: 600,
      maxChunks: 40,
    });
    const secondStart = chunks[1]?.text ?? '';
    expect(secondStart.startsWith('CHAPTER 2 NEXT')).toBe(true);
  });

  it('merges a tiny tail into the previous chunk when it fits', () => {
    const body = `${para('one', 20).slice(0, 380)}\n\ntiny tail words here`;
    const chunks = chunkMaterials([text('m', 'h', body)], config);
    expect(chunks).toHaveLength(1);
  });

  it('skips pages without text and handles empty material', () => {
    expect(chunkMaterials([pdf('m', 'h', ['', ''])], config)).toEqual([]);
  });

  it('gives different ids to different content', () => {
    const a = chunkMaterials([text('m', 'h1', para('a', 5))], config)[0]?.id;
    const b = chunkMaterials([text('m', 'h2', para('a', 5))], config)[0]?.id;
    expect(a).not.toBe(b);
  });
});

describe('headingScore', () => {
  it.each([
    ['Chapter 3: Trees', true],
    ['1.2 Hash tables', true],
    ['SQL BASICS', true],
    ['This is an ordinary sentence that ends with a period.', false],
  ])('%s', (line, heading) => expect(headingScore(line) > 0).toBe(heading));
});
