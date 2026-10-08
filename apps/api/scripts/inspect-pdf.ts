/**
 * Dev tool: shows exactly what PrepFlow would extract from a PDF, using the SAME extractor, normalization
 * and quality rules as the server (no database, no AI, nothing stored; the file is only read).
 *
 *   npm run pdf:inspect -- "C:\path\to\notes.pdf"
 *   npm run pdf:inspect -- notes.pdf --preview 200     (characters of preview per page, default 100)
 *   npm run pdf:inspect -- notes.pdf --page 3          (print the full normalized text of PDF page 3)
 *
 * Exit code 0 = PrepFlow would accept this PDF, 1 = it would be rejected, 2 = bad usage.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_MATERIAL_LIMITS, TEXT_QUALITY } from '@prepflow/shared';
import { buildPdfDocument } from '../src/domain/documents/document.js';
import { countUsableChars, normalizeText } from '../src/domain/documents/normalize.js';
import { PdfJsTextExtractor } from '../src/infrastructure/pdf/pdfjs-text-extractor.js';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<number> {
  const args = process.argv
    .slice(2)
    .filter((arg, i, all) => !arg.startsWith('--') && !all[i - 1]?.startsWith('--'));
  const input = args[0];
  if (!input) {
    console.error('Usage: npm run pdf:inspect -- <file.pdf> [--preview N] [--page N]');
    return 2;
  }
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), input);
  const preview = Number(flag('--preview') ?? 100);
  const wantedPage = flag('--page') === undefined ? null : Number(flag('--page'));

  const data = await readFile(path);
  console.log(`File: ${path}`);
  console.log(
    `Size: ${(data.length / 1024).toFixed(0)} KB (limit ${(DEFAULT_MATERIAL_LIMITS.maxPdfBytes / 1048576).toFixed(0)} MB)`,
  );

  let rawPages: string[];
  try {
    rawPages = await new PdfJsTextExtractor().extract(data, {
      maxPages: DEFAULT_MATERIAL_LIMITS.maxPdfPages,
    });
  } catch (error) {
    const e = error as { code?: string; message?: string };
    console.log(`\nREJECTED at extraction: ${e.code ?? 'ERROR'}: ${e.message ?? String(error)}`);
    return 1;
  }

  console.log(
    `Pages: ${rawPages.length} (physical PDF pages; limit ${DEFAULT_MATERIAL_LIMITS.maxPdfPages})\n`,
  );
  console.log('PDF page | usable chars | status    | preview');
  console.log('---------+--------------+-----------+--------');
  rawPages.forEach((raw, index) => {
    const text = normalizeText(raw);
    const usable = countUsableChars(text);
    const status =
      usable >= TEXT_QUALITY.minUsableCharsPerPage ? 'text' : usable === 0 ? 'EMPTY' : 'LOW TEXT';
    const line = text.replace(/\s+/g, ' ').slice(0, preview);
    console.log(
      `${String(index + 1).padStart(8)} | ${String(usable).padStart(12)} | ${status.padEnd(9)} | ${line}`,
    );
  });

  if (wantedPage !== null) {
    const raw = rawPages[wantedPage - 1];
    console.log(`\n===== PDF page ${wantedPage} (normalized) =====`);
    console.log(raw === undefined ? '(no such page)' : normalizeText(raw));
  }

  try {
    const doc = buildPdfDocument(rawPages, 'inspected.pdf', DEFAULT_MATERIAL_LIMITS);
    console.log(
      `\nACCEPTED: ${doc.charCount.toLocaleString('en-US')} characters, ${doc.pageCount} pages, ${doc.lowTextPageCount} with little or no text.`,
    );
    return 0;
  } catch (error) {
    const e = error as { code?: string; message?: string };
    console.log(`\nREJECTED: ${e.code}: ${e.message}`);
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
