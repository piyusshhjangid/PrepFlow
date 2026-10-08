import { describe, expect, it } from 'vitest';
import { looksLikePdf, sanitizeFilename } from './filename.js';
import { countUsableChars, hashText, normalizeText } from './normalize.js';

describe('normalizeText', () => {
  it('unifies line endings and collapses whitespace without rewording', () => {
    expect(normalizeText('Unit 1\r\n\r\n\r\n\r\nNormalization   (1NF,\t2NF)  \r\n')).toBe(
      'Unit 1\n\nNormalization (1NF, 2NF)',
    );
  });

  it('removes NUL bytes, control characters and zero-width characters', () => {
    expect(normalizeText('Dead\u0000locks\u0007 and\u200B semaphores')).toBe(
      'Deadlocks and semaphores',
    );
  });

  it('removes form feeds so a stored page separator can never appear inside page content', () => {
    expect(normalizeText('a\fb')).toBe('ab');
  });

  it('is idempotent', () => {
    const once = normalizeText('  x\r\n\r\n\r\n y\u00A0\u00A0z ');
    expect(normalizeText(once)).toBe(once);
  });

  it('keeps non-Latin text intact', () => {
    expect(normalizeText('डेटाबेस प्रबंधन प्रणाली')).toBe('डेटाबेस प्रबंधन प्रणाली');
  });
});

describe('countUsableChars / hashText', () => {
  it('ignores whitespace', () => {
    expect(countUsableChars('a b\n\n c')).toBe(3);
  });

  it('hashes equal text equally and different text differently', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
    expect(hashText('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('sanitizeFilename', () => {
  it.each([
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\notes.pdf', 'notes.pdf'],
    ['  my\u0000 notes\n.pdf ', 'my notes.pdf'],
    ['', 'document.pdf'],
    ['..', 'document.pdf'],
  ])('cleans %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('truncates very long names', () => {
    expect(sanitizeFilename(`${'a'.repeat(500)}.pdf`).length).toBe(120);
  });
});

describe('looksLikePdf', () => {
  it('checks magic bytes, not the file name', () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.7\n...'))).toBe(true);
    expect(looksLikePdf(Buffer.from('MZ\u0090\u0000 not a pdf'))).toBe(false);
    expect(looksLikePdf(Buffer.alloc(0))).toBe(false);
  });
});
