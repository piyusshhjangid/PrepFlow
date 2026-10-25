import { describe, expect, it } from 'vitest';
import { CHUNK_MAX, chunkText, MAX_MATERIAL_CHARS, validateMaterial } from './chunk';

describe('validateMaterial', () => {
  it('rejects empty, too short and too long input with readable messages', () => {
    expect(validateMaterial('')).toMatch(/Add some study material/);
    expect(validateMaterial('   \n ')).toMatch(/Add some study material/);
    expect(validateMaterial('too short')).toMatch(/too short/);
    expect(validateMaterial('x'.repeat(MAX_MATERIAL_CHARS + 1))).toMatch(/limit/);
    expect(validateMaterial('word '.repeat(40))).toBeNull();
  });
});

describe('chunkText', () => {
  it('keeps short material in one chunk', () => {
    expect(chunkText('Unit 1\n\nSome notes here.')).toEqual(['Unit 1\n\nSome notes here.']);
  });
  it('splits at paragraph boundaries and loses no text', () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) =>
      `Paragraph ${i}: ${'lorem ipsum '.repeat(40)}`.trim(),
    );
    const chunks = chunkText(paragraphs.join('\n\n'));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= CHUNK_MAX)).toBe(true);
    expect(chunks.join('\n\n')).toBe(paragraphs.join('\n\n'));
  });
  it('splits a single enormous paragraph without exceeding the maximum', () => {
    const chunks = chunkText('A sentence goes here. '.repeat(2000));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= CHUNK_MAX)).toBe(true);
  });
  it('splits on PDF page breaks too', () => {
    expect(chunkText('page one text\fpage two text')).toEqual(['page one text\n\npage two text']);
  });
});
