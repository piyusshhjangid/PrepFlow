export const MAX_MATERIAL_CHARS = 60_000;
export const MIN_MATERIAL_CHARS = 80;
export const CHUNK_TARGET = 6000;
export const CHUNK_MAX = 8000;
export const MAX_CHUNKS = 12;

export function validateMaterial(text: string): string | null {
  const t = text.trim();
  if (t.length === 0) return 'Add some study material first: paste text or upload a PDF.';
  if (t.length < MIN_MATERIAL_CHARS)
    return 'That is too short to find topics in. Paste at least a few lines of syllabus or notes.';
  if (t.length > MAX_MATERIAL_CHARS)
    return `That is ${t.length.toLocaleString('en-US')} characters. The limit is ${MAX_MATERIAL_CHARS.toLocaleString('en-US')}: keep only the chapters you need.`;
  return null;
}

/** Splits at paragraph boundaries, then sentences, then words; never emits a chunk above CHUNK_MAX. */
export function chunkText(text: string): string[] {
  const pieces = text
    .split(/\n{2,}|\f/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap(splitLong);
  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > CHUNK_TARGET) {
      chunks.push(current);
      current = piece;
    } else current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitLong(piece: string): string[] {
  if (piece.length <= CHUNK_MAX) return [piece];
  const out: string[] = [];
  let rest = piece;
  while (rest.length > CHUNK_MAX) {
    const window = rest.slice(0, CHUNK_MAX);
    const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'));
    const space = window.lastIndexOf(' ');
    const cut = sentence > CHUNK_MAX / 2 ? sentence + 1 : space > CHUNK_MAX / 2 ? space : CHUNK_MAX;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
